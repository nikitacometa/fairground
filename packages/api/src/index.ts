// Must be first: installs the global fetch proxy dispatcher (when HTTPS_PROXY is set)
// before any algod call. The API reads on-chain config/pot state via raw fetch for
// /stats and /jackpot; on the shared VPS IP those get 403'd by AlgoNode's per-IP quota,
// so they route through the same residential proxy as the keeper.
import './proxy-bootstrap.js';
import { serve } from '@hono/node-server';
import type { WebSocketServerLike } from '@hono/node-server';
import { createApp, logger, redis } from './app.js';
import { createWebSocketServer } from './routes/ws.js';
import { env } from './env.js';

const app = createApp();

// Build the raw WebSocket server with { noServer: true } so @hono/node-server
// owns the 'upgrade' event and routes WS connections through Hono middleware
// (geo-block, CORS) before handing off to the Redis fan-out in ws.ts.
// ws.WebSocketServer satisfies WebSocketServerLike structurally; the cast is safe.
const wss = createWebSocketServer(redis, logger) as unknown as WebSocketServerLike;

// serve() from @hono/node-server properly forwards method, headers, and body
// from the incoming IncomingMessage into the Fetch API Request — fixing the
// broken custom handler that was stripping all headers and defaulting POST to GET.
const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
    websocket: { server: wss },
  },
  (info) => {
    logger.info({ port: info.port, network: env.ALGORAND_NETWORK }, 'fairground-api started');
  },
);

process.on('SIGTERM', () => {
  logger.info('SIGTERM received -- shutting down');
  server.close(() => process.exit(0));
});
