import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type Redis from 'ioredis';
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
 * Attach a WebSocket server to the HTTP server.
 * Subscribes to Redis pub/sub channels and fans out events to connected clients.
 *
 * Keeper publishes to Redis; this handler broadcasts to game dApp clients.
 * Path: ws://api.fairground.xyz/ws
 */
export function attachWebSocket(server: Server, redis: Redis, logger: Logger): void {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set<WebSocket>();

  const subscriber = redis.duplicate();

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
}

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
