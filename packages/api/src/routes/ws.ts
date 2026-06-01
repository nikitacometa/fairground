import { WebSocketServer, WebSocket } from 'ws';
import { upgradeWebSocket } from '@hono/node-server';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';

// Redis pub/sub channel names
const CHANNEL_BET_RESOLVED = 'fairground:bet:resolved';
const CHANNEL_JACKPOT_HIT = 'fairground:jackpot:hit';

export interface ResolvedEvent {
  type: 'bet:resolved';
  betId: string;
  walletAddress: string;
  outcome: 'heads' | 'tails';
  netPayoutMicroalgo: string;
  vrfRound: string;
  proofCardUrl: string | null;
}

export interface JackpotEvent {
  type: 'jackpot:hit';
  walletAddress: string;
  amountMicroalgo: string;
}

/**
 * Create the WebSocket server with { noServer: true } so @hono/node-server
 * can attach its own 'upgrade' handler via serve({ websocket: { server: wss } }).
 *
 * Subscribes to Redis pub/sub channels and fans out events to connected clients.
 * Keeper publishes to Redis; this handler broadcasts to game dApp clients.
 * Path: ws://api.fairground.xyz/ws
 */
export function createWebSocketServer(redis: Redis, logger: Logger): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  const subscriber = redis.duplicate();

  // Guard against process crash on Redis disconnect
  subscriber.on('error', (err: Error) => {
    logger.error({ err }, 'WS Redis subscriber error');
  });

  void subscriber.subscribe(CHANNEL_BET_RESOLVED, CHANNEL_JACKPOT_HIT);

  subscriber.on('message', (channel: string, message: string) => {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    }
    logger.debug({ channel, clients: clients.size }, 'broadcast WS event');
  });

  wss.on('connection', (ws, req) => {
    clients.add(ws);
    logger.debug({ clients: clients.size, url: req.url }, 'WS client connected');

    ws.on('close', () => {
      clients.delete(ws);
      logger.debug({ clients: clients.size }, 'WS client disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'WS error');
      clients.delete(ws);
    });
  });

  return wss;
}

/**
 * Hono route handler for GET /ws.
 * Uses @hono/node-server's upgradeWebSocket middleware; the actual fan-out
 * is handled by the Redis subscriber set up in createWebSocketServer().
 */
export const wsRoute = upgradeWebSocket(() => {
  return {
    // The Redis pub/sub fan-out runs on the raw ws instance managed by
    // createWebSocketServer(). This Hono handler just accepts the upgrade.
    onError(err, ws) {
      ws.close(1011, err instanceof Error ? err.message.slice(0, 120) : 'socket error');
    },
  };
});

/**
 * Publish a resolved bet event to Redis for WS fan-out.
 * Called by the keeper after resolve() confirms on-chain.
 */
export async function publishBetResolved(redis: Redis, event: ResolvedEvent): Promise<void> {
  await redis.publish(CHANNEL_BET_RESOLVED, JSON.stringify(event));
}

/**
 * Publish a jackpot hit event.
 */
export async function publishJackpotHit(redis: Redis, event: JackpotEvent): Promise<void> {
  await redis.publish(CHANNEL_JACKPOT_HIT, JSON.stringify(event));
}
