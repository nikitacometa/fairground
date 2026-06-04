/**
 * Platform + contract version registry — the single source of truth for "what is deployed."
 *
 * Versioning model (hybrid, chosen 2026-06-04):
 *  - PLATFORM_VERSION: one semver for the whole off-chain bundle (api + keeper + game +
 *    landing + shared packages). The monorepo deploys as a unit, so one number answers
 *    "what is live." Surfaced at GET /status and in the web footers.
 *  - CONTRACTS: contracts are immutable on-chain entities — a deployed app id cannot be
 *    "bumped"; a change means a new app id. Each carries its own integer version tied to
 *    its app id + ABI. This registry is the compatibility map between a platform release
 *    and the on-chain apps it targets.
 *
 * SemVer policy: MAJOR = contract redeploy / breaking ABI / non-backward-compatible DB
 * migration; MINOR = backward-compatible feature; PATCH = bug fix. v1.0.0 = public launch
 * (geo-block live + funded treasury). Pre-1.0 = pre-public-launch hardening.
 */

export const PLATFORM_VERSION = '0.9.2';

/** Live mainnet VRF beacon (Applied Blockchain). The 2022-era 947957720 is dead. */
export const MAINNET_VRF_BEACON_APP_ID = 1_615_566_206n;

export interface ContractDeployment {
  /** On-chain application id. Immutable; a redeploy produces a new id + a version bump. */
  appId: bigint;
  /** Contract semantic version, tied to this app id and its ABI. */
  version: number;
  /** ISO date of this deployment. */
  deployedAt: string;
}

/**
 * Canonical mainnet contract deployments. On any redeploy: new app id => version++, update
 * this registry and bump PLATFORM_VERSION's MAJOR in the same release. (The leaderboard
 * contract exists but is not wired into Coinflip v1, so it is intentionally omitted here.)
 */
export const CONTRACTS = {
  coinflip: { appId: 3_585_680_948n, version: 1, deployedAt: '2026-06-03' },
  houseTreasury: { appId: 3_584_287_403n, version: 1, deployedAt: '2026-06-02' },
} as const satisfies Record<string, ContractDeployment>;

export interface ConfigProblem {
  key: string;
  message: string;
}

/**
 * Assert mainnet configuration invariants. Returns the problems (empty when sane) so the
 * caller can log them loudly at startup. Non-throwing by design: a benign mismatch should
 * shout in the logs, not brick the process. Catches the config-drift landmines the
 * 2026-06-04 audit found (dead beacon default, wrong CORS/domain, stale app ids).
 */
export function checkMainnetConfig(cfg: {
  network: string;
  vrfBeaconAppId: bigint;
  coinflipAppId: bigint;
  houseTreasuryAppId: bigint;
  corsOrigins: string[];
}): ConfigProblem[] {
  if (cfg.network !== 'mainnet') return [];
  const problems: ConfigProblem[] = [];
  if (cfg.vrfBeaconAppId !== MAINNET_VRF_BEACON_APP_ID) {
    problems.push({
      key: 'VRF_BEACON_APP_ID',
      message: `expected live beacon ${MAINNET_VRF_BEACON_APP_ID} on mainnet, got ${cfg.vrfBeaconAppId} (947957720 is the dead 2022 beacon — resolve() will panic)`,
    });
  }
  if (cfg.coinflipAppId !== CONTRACTS.coinflip.appId) {
    problems.push({
      key: 'COINFLIP_APP_ID',
      message: `expected canonical coinflip ${CONTRACTS.coinflip.appId}, got ${cfg.coinflipAppId}`,
    });
  }
  if (cfg.houseTreasuryAppId !== CONTRACTS.houseTreasury.appId) {
    problems.push({
      key: 'HOUSE_TREASURY_APP_ID',
      message: `expected canonical house_treasury ${CONTRACTS.houseTreasury.appId}, got ${cfg.houseTreasuryAppId}`,
    });
  }
  if (!cfg.corsOrigins.some((o) => o.includes('fairground.quest'))) {
    problems.push({
      key: 'CORS_ORIGINS',
      message: `no fairground.quest origin in CORS list ${JSON.stringify(cfg.corsOrigins)} — browser calls from prod will be blocked`,
    });
  }
  return problems;
}
