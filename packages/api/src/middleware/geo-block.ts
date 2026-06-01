import type { Context, Next } from 'hono';

/**
 * Geo-block middleware for @fairground/api.
 *
 * Blocked jurisdictions: US, UK, TH (Thailand), ID (Indonesia), IN (India), BR (Brazil).
 * Thai block is non-negotiable -- Thailand bans online gambling with active enforcement.
 *
 * In production, Cloudflare Workers geo-block is preferred (CDN layer, not bypassable
 * via Accept-Language). This middleware is the API-layer backstop.
 *
 * Cloudflare sets the CF-IPCountry header on every request.
 * If running behind Nginx without Cloudflare, adapt to use X-Real-IP + MaxMind.
 */

const BLOCKED_COUNTRY_CODES = new Set(['US', 'GB', 'TH', 'ID', 'IN', 'BR']);

export async function geoBlock(c: Context, next: Next): Promise<Response | void> {
  // Cloudflare passes the ISO 3166-1 alpha-2 country code in this header
  const country = c.req.header('CF-IPCountry') ?? '';
  if (BLOCKED_COUNTRY_CODES.has(country.toUpperCase())) {
    return c.json(
      {
        ok: false as const,
        error: 'unavailable_for_legal_reasons',
        code: 'geo_blocked',
      },
      451,
    );
  }
  await next();
}
