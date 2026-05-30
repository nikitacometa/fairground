# Geo-Blocking Spec

**Required before any public announcement or Foundation RT.**
**Non-negotiable: Thai IP block (TH). Active enforcement, Nikita in Bangkok.**

## Blocked Jurisdictions

| Code | Country | Reason |
|------|---------|--------|
| US | United States | UIGEA (Unlawful Internet Gambling Enforcement Act), CFTC jurisdiction |
| GB | United Kingdom | UK Gambling Commission licensing required |
| TH | Thailand | Full online gambling ban, 220K+ URLs blocked in 3.5 months, active enforcement |
| ID | Indonesia | Law No. 7 of 1974, strict enforcement |
| IN | India | Public Gambling Act 1867, Information Technology Act |
| BR | Brazil | Federal law 3,688/41, active enforcement since 2023 |

## Implementation: Cloudflare Workers (Preferred)

CDN-layer blocking cannot be bypassed by changing Accept-Language headers.
Cloudflare Workers run before the request reaches the API.

```javascript
// Cloudflare Worker -- geo-block.js
// Deploy at: Workers & Pages -> Create Application -> Worker

const BLOCKED = new Set(['US', 'GB', 'TH', 'ID', 'IN', 'BR']);

export default {
  async fetch(request, env) {
    const country = request.cf?.country ?? '';
    if (BLOCKED.has(country.toUpperCase())) {
      return new Response(
        JSON.stringify({
          error: 'unavailable_for_legal_reasons',
          country,
        }),
        {
          status: 451,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
    return fetch(request);
  },
};
```

**Cloudflare setup:**
1. Register fairground.xyz at Cloudflare (DNS proxy enabled)
2. Create Worker at Workers & Pages -> Create
3. Add route: `api.fairground.xyz/*` -> geo-block Worker
4. Add route: `app.fairground.xyz/*` -> geo-block Worker (game dApp)
5. Test: curl -H "CF-IPCountry: TH" https://api.fairground.xyz/health
   Expected: 451 status

**Cloudflare free plan:** Workers: 100K req/day free. Sufficient for launch.

## Fallback: API Middleware

If Cloudflare is not yet configured, the API-layer backstop is active in
`packages/api/src/middleware/geo-block.ts`. It reads `CF-IPCountry` header
set by Cloudflare, or can be adapted to use X-Real-IP + MaxMind GeoIP.

This is NOT equivalent to Cloudflare Workers -- a determined user can bypass
it by spoofing Accept-Language or using a VPN. Use only as temporary backstop.

## Verification

```bash
# Test Thai block (production)
curl -s -o /dev/null -w "%{http_code}" https://api.fairground.xyz/health \
  -H "CF-IPCountry: TH"
# Expected: 451

# Test allowed country (Singapore)
curl -s -o /dev/null -w "%{http_code}" https://api.fairground.xyz/health \
  -H "CF-IPCountry: SG"
# Expected: 200
```

## Timing

- Geo-block must be LIVE before:
  - Any mention in Algorand ecosystem newsletters
  - Requesting a Foundation RT or xGov submission
  - Any DM campaign to known influencers
  - Opening the invite link to more than 5 testers

## xGov Compliance Note

Framing for Foundation channels: "VRF technology demonstration that also pays out."
Never describe as gambling in Foundation-facing content.
The open-source VRF contracts + proof card engine are the grant-eligible artifacts.
