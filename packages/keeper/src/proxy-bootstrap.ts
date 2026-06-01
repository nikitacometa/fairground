/**
 * Routes all outbound `fetch` (algosdk algod/indexer calls) through an HTTP proxy
 * when HTTPS_PROXY / HTTP_PROXY is set. Node's native fetch (undici) does NOT honor
 * proxy env vars on its own — a global dispatcher must be installed explicitly.
 *
 * Why the keeper needs this: it polls algod every 4s. On the shared Hostinger VPS IP
 * this competes with the Cometa backend for AlgoNode's per-IP daily free quota
 * (~200k req/day), which the combined traffic exhausts → 403 Forbidden → the keeper
 * can no longer read the current round or submit resolve() txns. Routing the keeper
 * through a Decodo ISP residential proxy gives it an isolated egress IP with its own
 * quota, so Fairground never competes with Cometa for the same bucket.
 *
 * Postgres (pg) and Redis (ioredis) use raw TCP sockets, not fetch, so they are
 * unaffected by the global dispatcher. NO_PROXY additionally excludes internal hosts
 * as a belt-and-suspenders guard against any future internal fetch call.
 *
 * This module must be imported before any algod client issues a request. It is the
 * first import in index.ts so the dispatcher is installed at process start.
 */
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';

const proxyUrl = process.env['HTTPS_PROXY'] ?? process.env['HTTP_PROXY'];

if (proxyUrl) {
  // EnvHttpProxyAgent reads HTTP_PROXY / HTTPS_PROXY / NO_PROXY from the environment
  // and tunnels HTTPS targets via CONNECT. Setting it as the global dispatcher makes
  // node's built-in fetch (and therefore algosdk's URLTokenBaseHTTPClient) use it.
  setGlobalDispatcher(new EnvHttpProxyAgent());
  const masked = proxyUrl.replace(/\/\/[^@]+@/, '//***@');
  // Bare console: this runs before the pino logger is constructed in index.ts.
  console.log(`[proxy] outbound fetch routed via ${masked}`);
}
