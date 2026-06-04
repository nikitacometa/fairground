import { Hono } from 'hono';
import { db, bets } from '@fairground/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';

/**
 * Referral earnings for a wallet, summed over every resolved flip that named it as the on-chain
 * referrer. The contract pays the referrer `referralRakeBps` (1%) of each stake on resolve, so the
 * earned amount is `sum(amount * referral_rake_bps / 10000)` — integer division mirrors the
 * contract (bet * REFERRAL_BPS // BPS_DENOMINATOR). Referral is paid on a win or a loss alike.
 *
 * NOTE: `referrerWallet` / `amountMicroalgo` come from the client at registration (same trust level
 * as the live leaderboard's volume/P&L), so this is a display figure, not a verified on-chain
 * total. Deriving both from the resolve txn's referral inner-payment is a tracked follow-up that
 * would harden the leaderboard and this endpoint together.
 */
export function makeReferralsRouter(logger: Logger): Hono {
  const app = new Hono();

  app.get('/:address', async (c) => {
    const address = c.req.param('address');
    if (address.length !== 58) {
      return c.json(
        { ok: false as const, error: 'invalid_address', code: 'validation_error' },
        400,
      );
    }
    try {
      const [row] = await db
        .select({
          referredCount: sql`count(*)`.mapWith(Number),
          referredVolume: sql`coalesce(sum(${bets.amountMicroalgo}), 0)`.mapWith(String),
          totalEarned:
            sql`coalesce(sum(${bets.amountMicroalgo} * ${bets.referralRakeBps} / 10000), 0)`.mapWith(
              String,
            ),
        })
        .from(bets)
        .where(and(eq(bets.referrerWallet, address), inArray(bets.outcome, ['win', 'loss'])));

      return c.json({
        ok: true as const,
        data: {
          address,
          referredCount: row?.referredCount ?? 0,
          referredVolumeMicroalgo: row?.referredVolume ?? '0',
          totalEarnedMicroalgo: row?.totalEarned ?? '0',
        },
      });
    } catch (err) {
      logger.error({ err, address }, 'failed to compute referral stats');
      return c.json({ ok: false as const, error: 'internal_error', code: 'db_error' }, 500);
    }
  });

  return app;
}
