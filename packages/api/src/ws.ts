/**
 * WebSocket endpoint at /ws.
 *
 * Uses @hono/node-ws for WebSocket support under @hono/node-server.
 * The upgradeWebSocket helper wraps the native ws upgrade without needing
 * a separate http.Server reference — node-ws injects it at serve() time.
 *
 * Architecture:
 *   - Keeper publishes resolved events to the Redis pub/sub channel "fg:events".
 *   - This module subscribes once at startup (via a dedicated ioredis subscriber
 *     connection, separate from the command connection used by routes).
 *   - On each incoming message, it fans out to all connected WebSocket clients.
 *
 * Event shape (JSON):
 *   { type: "resolved", sessionId, outcome, netPayoutMicroalgo, proofCardUrl }
 *   { type: "jackpot",  winner, amountMicroalgo }
 *   { type: "treasury_paused" }
 *   { type: "ping" }   — keepalive sent every 30s to prevent idle closure
 *
 * Client → server messages are ignored in v1 (read-only feed). In v2, clients
 * may subscribe to a specific session ID for targeted notifications.
 */

import type { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';
import type { WSContext } from 'hono/ws';
import type Redis from 'ioredis';
import type { Logger } from 'pino';

export const EVENTS_CHANNEL = 'fg:events';

// Keepalive interval. Cloudflare/nginx typically close idle WS after 60-90s.
const PING_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Connection registry — simple Set, good enough for a single-process API.
// For multi-instance deployments, all instances subscribe to the same Redis
// channel so each fans out to its own local clients independently.
// ---------------------------------------------------------------------------
const clients = new Set<WSContext>();

function broadcast(message: string): void {
  for (const ws of clients) {
    try {
      ws.send(message);
    } catch {
      // Client closed mid-send — remove it; the onClose handler will also fire.
      clients.delete(ws);
    }
  }
}

// ---------------------------------------------------------------------------
// Redis subscriber setup — called once at startup.
// The subscriber connection is dedicated (ioredis requirement: a connection
// in subscribe mode cannot issue other commands).
// ---------------------------------------------------------------------------
export function startRedisSubscriber(subscriber: Redis, logger: Logger): void {
  subscriber.subscribe(EVENTS_CHANNEL, (err) => {
    if (err) {
      logger.error({ err }, 'ws: failed to subscribe to Redis channel');
    } else {
      logger.info({ channel: EVENTS_CHANNEL }, 'ws: subscribed to Redis events channel');
    }
  });

  subscriber.on('message', (_channel: string, message: string) => {
    if (clients.size === 0) return; // skip serialization overhead if no clients
    broadcast(message);
  });

  subscriber.on('error', (err: Error) => {
    logger.error({ err }, 'ws: Redis subscriber error');
  });
}

// ---------------------------------------------------------------------------
// Keepalive loop — runs as long as the process is alive.
// Sends a JSON ping to all connected clients so their browsers don't close
// the connection due to inactivity.
// ---------------------------------------------------------------------------
function startKeepalive(logger: Logger): NodeJS.Timeout {
  return setInterval(() => {
    if (clients.size === 0) return;
    const ping = JSON.stringify({ type: 'ping', ts: Date.now() });
    logger.debug({ clients: clients.size }, 'ws: sending keepalive ping');
    broadcast(ping);
  }, PING_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function mountWebSocket(
  app: Hono,
  subscriber: Redis,
  logger: Logger,
): { injectWebSocket: ReturnType<typeof createNodeWebSocket>['injectWebSocket'] } {
  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

  startRedisSubscriber(subscriber, logger);
  startKeepalive(logger);

  app.get(
    '/ws',
    upgradeWebSocket((_c) => ({
      onOpen(_evt, ws) {
        clients.add(ws);
        logger.debug({ clients: clients.size }, 'ws: client connected');
        // Send a welcome message so the client knows the connection is live.
        ws.send(JSON.stringify({ type: 'connected', clients: clients.size }));
      },

      onMessage(evt, _ws) {
        // v1: ignore all client messages (read-only feed).
        // v2 TODO: parse { type: "subscribe", sessionId } and add to a
        //   per-session subscriber map for targeted resolution notifications.
        logger.debug({ data: String(evt.data) }, 'ws: client message ignored');
      },

      onClose(_evt, ws) {
        clients.delete(ws);
        logger.debug({ clients: clients.size }, 'ws: client disconnected');
      },

      onError(evt, ws) {
        logger.warn({ err: evt }, 'ws: client error');
        clients.delete(ws);
      },
    })),
  );

  return { injectWebSocket };
}
