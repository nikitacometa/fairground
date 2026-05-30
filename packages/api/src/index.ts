import { serve } from '@hono/node-server';
import { createServer } from 'node:http';
import { createApp, logger, redis } from './app.js';
import { attachWebSocket } from './routes/ws.js';
import { env } from './env.js';

const app = createApp();

// @hono/node-server 2.x: pass a fetch handler to createServer for WS upgrade support
const server = createServer((req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  app.fetch(new Request(`http://localhost${req.url}`)).then(async (honoRes) => {
    res.writeHead(honoRes.status, Object.fromEntries(honoRes.headers.entries()));
    const body = await honoRes.arrayBuffer();
    res.end(Buffer.from(body));
  });
});

attachWebSocket(server, redis, logger);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, network: env.ALGORAND_NETWORK }, 'fairground-api started');
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received -- shutting down');
  server.close(() => process.exit(0));
});
