import { z } from 'zod/v4';

// Shared env schema used by @fairground/api and @fairground/keeper.
// Each package extends this with its own required fields.

export const BaseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ALGOD_URL: z.string().url().default('https://mainnet-api.algonode.cloud'),
  ALGOD_TOKEN: z.string().default(''),
  INDEXER_URL: z.string().url().default('https://mainnet-idx.algonode.cloud'),
  ALGORAND_NETWORK: z.enum(['localnet', 'testnet', 'mainnet']).default('localnet'),
  HOUSE_TREASURY_APP_ID: z.coerce.bigint().positive(),
  COINFLIP_APP_ID: z.coerce.bigint().positive(),
  // Live mainnet beacon (Applied Blockchain). The 2022-era 947957720 is DEAD — its
  // must_get() panics on any current round. Defaulting to the live id makes a fresh
  // deploy that forgets the env var safe instead of silently stuck. (audit 2026-06-04)
  VRF_BEACON_APP_ID: z.coerce.bigint().default(1615566206n),
  MIN_BET_MICROALGO: z.coerce.bigint().positive().default(500000n),
  MAX_BET_MICROALGO: z.coerce.bigint().positive().default(500000n),
  TREASURY_MIN_BALANCE_MICROALGO: z.coerce.bigint().positive().default(2000000000n),
  CORS_ORIGINS: z
    .string()
    .default('https://fairground.quest,https://app.fairground.quest,http://localhost:3000')
    .transform((s) => s.split(',').map((o) => o.trim())),
});

export type BaseEnv = z.infer<typeof BaseEnvSchema>;

export const ApiEnvSchema = BaseEnvSchema.extend({
  PORT: z.coerce.number().int().positive().default(3010),
});

export type ApiEnv = z.infer<typeof ApiEnvSchema>;

export const KeeperEnvSchema = BaseEnvSchema.extend({
  KEEPER_INSTANCE_ID: z.enum(['primary', 'standby']),
  HOUSE_SEED_WALLET_MNEMONIC: z.string().min(1),
});

export type KeeperEnv = z.infer<typeof KeeperEnvSchema>;
