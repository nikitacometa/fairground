/**
 * Geo-blocking middleware for Fairground API.
 *
 * REQUIRED before any public launch or Foundation RT. See docs/compliance.md.
 *
 * This is a SOFT layer. It reads the CF-IPCountry header set by Cloudflare,
 * or a configurable fallback header. It does NOT replace Cloudflare Workers
 * geo-blocking (which operates at the CDN edge, before any request reaches
 * the server). Both layers must be active in production.
 *
 * Blocked jurisdictions (docs/compliance.md, Section "Jurisdictions to Geo-Block"):
 *   US — UIGEA 2006 + CFTC jurisdiction
 *   GB — UK Gambling Act 2005
 *   TH — Gambling Act B.E. 2478 (NON-NEGOTIABLE — Nikita operates from Bangkok)
 *   ID — Criminal Code prohibition on online gambling
 *   IN — IT Act 2000 + state gambling laws
 *   BR — Lei de Jogos 2023
 *
 * In production: Cloudflare sets CF-IPCountry on every request.
 * In dev/staging: set GEO_HEADER_NAME to "x-mock-country" and inject the header
 * from your test client. Never allow bypassing this check via user-supplied
 * assertions (e.g., Accept-Language or user-provided lat/lon).
 */

import type { Context, Next } from 'hono';

const BLOCKED_COUNTRIES = new Set(['US', 'GB', 'TH', 'ID', 'IN', 'BR']);

// The header Cloudflare injects. Override with GEO_HEADER_NAME env var for
// local testing. Keep the default as CF-IPCountry in production.
const GEO_HEADER =
  (process.env['GEO_HEADER_NAME'] ?? 'cf-ipcountry').toLowerCase();

export async function geoBlock(c: Context, next: Next): Promise<Response | void> {
  const countryCode = c.req.header(GEO_HEADER);

  if (countryCode && BLOCKED_COUNTRIES.has(countryCode.toUpperCase())) {
    return c.json(
      {
        ok: false,
        error: 'This service is not available in your jurisdiction.',
        code: 'GEO_BLOCKED',
        // Expose the country code so Cloudflare Workers logs can confirm the
        // edge block is working. Strip in a production hardening pass if desired.
        country: countryCode.toUpperCase(),
      },
      403,
    );
  }

  // XX = Cloudflare's code for unknown / Tor / privacy proxy. Block it to
  // avoid jurisdiction ambiguity. "T1" is Cloudflare's Tor code.
  const upper = countryCode?.toUpperCase();
  if (upper === 'XX' || upper === 'T1') {
    return c.json(
      {
        ok: false,
        error: 'Access from anonymous networks is not permitted.',
        code: 'GEO_BLOCKED',
      },
      403,
    );
  }

  await next();
}
