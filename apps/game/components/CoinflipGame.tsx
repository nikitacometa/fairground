'use client';

/**
 * CoinflipGame — main game UI for the Fairground coinflip dApp.
 *
 * Flow:
 *   1. Player picks heads/tails and enters a bet amount.
 *   2. On "Flip", lib/coinflip.ts builds + signs + submits the flip group via the
 *      generated @fairground/sdk client, then recordBet() registers the session.
 *   3. A VRF wait plays out (commit round = current + 8, +4 settle buffer) as the
 *      coin tumbles and ten "blocks of certainty" fill in.
 *   4. We poll the API until the keeper resolves the session.
 *   5. Win/loss reveal: the coin lands, confetti fires on a win, proof card on share.
 *
 * demoOutcome runs the whole flow wallet-free with a forced result (see /demo).
 */

import { useWallet } from '@txnlab/use-wallet-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import confetti from 'canvas-confetti';
import { fetchBetState, recordBet } from '../lib/api';
import { sendFlip } from '../lib/coinflip';
import { AsciiCoin } from './AsciiCoin';
import { useRelayerWake } from './useRelayerWake';
import type { BetOutcome } from '@fairground/types';

// BOX_MBR from contract: 49,300 microALGO (FlipState 80 bytes: vrf_round8 + bet8 + salt_hash32 + referrer32)
const BOX_MBR = 49_300n;

// Bet bounds come from env so they track the deployed contract's enforced min/max
// (testnet ships 0.1 ALGO; mainnet v1 ships 0.5). A mismatch here would make every
// flip revert on-chain, so these must mirror MIN_BET_MICROALGO / MAX_BET_MICROALGO.
function envBigint(raw: string | undefined, fallback: bigint): bigint {
  if (!raw) return fallback;
  try {
    return BigInt(raw);
  } catch {
    return fallback;
  }
}
const MIN_BET = envBigint(process.env['NEXT_PUBLIC_MIN_BET_MICROALGO'], 500_000n);
const MAX_BET = envBigint(process.env['NEXT_PUBLIC_MAX_BET_MICROALGO'], 500_000n);
const MICRO = 1_000_000;
const MIN_BET_ALGO = Number(MIN_BET) / MICRO;
const MAX_BET_ALGO = Number(MAX_BET) / MICRO;
const NETWORK = process.env['NEXT_PUBLIC_ALGORAND_NETWORK'];

// Approx ms per Algorand block
const MS_PER_ROUND = 2800;
// VRF commit delay in rounds
const BEACON_DELAY = 8;
// 4-round safety buffer on top of commit round (beacon can write up to 3 rounds late)
const RESOLVE_BUFFER = 4;
// Total rounds before resolution attempt = 10
const VRF_ROUNDS = BEACON_DELAY + RESOLVE_BUFFER;
const VRF_MS = VRF_ROUNDS * MS_PER_ROUND; // ~28 000ms

type CoinSide = 'heads' | 'tails';
type GamePhase = 'idle' | 'signing' | 'pending' | 'resolved' | 'error';

interface ResolvedResult {
  outcome: BetOutcome;
  /** The side the player chose — used to render the outcome label correctly. */
  playerPick: CoinSide;
  netPayoutMicroalgo: bigint | null;
  proofCardUrl: string | null;
  txnId: string | null;
}

// Demo mode: a shortened VRF wait so the wallet-free walkthrough resolves quickly.
const DEMO_PENDING_MS = 3600;

export function CoinflipGame({ demoOutcome }: { demoOutcome?: 'win' | 'loss' | null } = {}) {
  const isDemo = Boolean(demoOutcome);
  const { activeAccount, transactionSigner } = useWallet();
  const [pick, setPick] = useState<CoinSide>('heads');
  const [betAlgo, setBetAlgo] = useState(MIN_BET_ALGO.toString());
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(VRF_MS);
  const [result, setResult] = useState<ResolvedResult | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  // Animated count-up of the win payout (microALGO -> ALGO), purely cosmetic.
  const [displayPayout, setDisplayPayout] = useState(0);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Re-wake WalletConnect relayer when mobile tab resurfaces
  useRelayerWake();

  const clearTimers = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const startCountdown = useCallback(() => {
    setCountdown(VRF_MS);
    const start = Date.now();
    countdownRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, VRF_MS - elapsed);
      setCountdown(remaining);
      if (remaining === 0 && countdownRef.current) {
        clearInterval(countdownRef.current);
      }
    }, 200);
  }, []);

  const pollResolution = useCallback(
    (sid: string, playerPick: CoinSide) => {
      const attempt = async () => {
        try {
          const state = await fetchBetState(sid);
          if (state.outcome !== 'pending') {
            clearTimers();
            setResult({
              outcome: state.outcome,
              playerPick,
              netPayoutMicroalgo: state.netPayoutMicroalgo,
              proofCardUrl: state.proofCardUrl,
              txnId: state.txnId,
            });
            setPhase('resolved');
            setShowShareModal(true);
          } else {
            pollRef.current = setTimeout(() => void attempt(), 3000);
          }
        } catch {
          // Transient error — keep polling
          pollRef.current = setTimeout(() => void attempt(), 5000);
        }
      };
      pollRef.current = setTimeout(() => void attempt(), VRF_MS);
    },
    [clearTimers],
  );

  const handleFlip = useCallback(async () => {
    if (!activeAccount) return;
    setError(null);
    setPhase('signing');

    try {
      const betMicroalgo = BigInt(Math.round(parseFloat(betAlgo) * MICRO));

      if (betMicroalgo < MIN_BET) {
        throw new Error(`Minimum bet is ${MIN_BET_ALGO} ALGO`);
      }
      if (betMicroalgo > MAX_BET) {
        throw new Error(`Maximum bet is ${MAX_BET_ALGO} ALGO`);
      }

      const coinflipAppId = BigInt(process.env['NEXT_PUBLIC_COINFLIP_APP_ID'] ?? '0');
      if (coinflipAppId === 0n) {
        throw new Error('Coinflip app is not configured');
      }

      // Generate a 32-byte random player salt and its hash.
      // The salt preimage is kept client-side — the contract only receives saltHash.
      // On resolve, sha256(beaconOutput || saltHash)[0] % 2 determines win (1) / loss (0).
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const saltHashBuffer = await crypto.subtle.digest('SHA-256', salt);
      const saltHash = new Uint8Array(saltHashBuffer);

      // Build + sign + submit the flip group via the generated client (lib/coinflip.ts).
      // The wallet prompts during this call; it resolves once the group is confirmed and
      // returns the committed VRF round read from the flip() ABI return.
      const { commitRound, txnId } = await sendFlip({
        network: NETWORK,
        coinflipAppId,
        sender: activeAccount.address,
        signer: transactionSigner,
        betMicroalgo,
        boxMbr: BOX_MBR,
        saltHash,
      });

      // Register the pending session so the keeper resolves it and the UI can poll.
      const { sessionId: sid } = await recordBet({
        walletAddress: activeAccount.address,
        txnId,
        commitRound,
        saltHash,
        betMicroalgo,
      });

      setPhase('pending');
      startCountdown();
      pollResolution(sid, pick);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [activeAccount, betAlgo, pick, transactionSigner, startCountdown, pollResolution]);

  // Wallet-free walkthrough: runs the full visual flow (sign → VRF wait → reveal) with a
  // forced outcome and a shortened wait, so the experience can be shown without a chain hit.
  const handleDemoFlip = useCallback(() => {
    if (!demoOutcome) return;
    setError(null);
    setPhase('signing');
    pollRef.current = setTimeout(() => {
      setPhase('pending');
      const start = Date.now();
      setCountdown(DEMO_PENDING_MS);
      countdownRef.current = setInterval(() => {
        const remaining = Math.max(0, DEMO_PENDING_MS - (Date.now() - start));
        setCountdown(remaining);
        if (remaining === 0 && countdownRef.current) clearInterval(countdownRef.current);
      }, 100);
      pollRef.current = setTimeout(() => {
        clearTimers();
        const betMicroalgo = BigInt(Math.round(parseFloat(betAlgo) * MICRO));
        setResult({
          outcome: demoOutcome,
          playerPick: pick,
          netPayoutMicroalgo: demoOutcome === 'win' ? (betMicroalgo * 2n * 9800n) / 10000n : null,
          proofCardUrl: null,
          txnId: null,
        });
        setPhase('resolved');
      }, DEMO_PENDING_MS);
    }, 700);
  }, [demoOutcome, betAlgo, pick, clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setPhase('idle');
    setError(null);
    setResult(null);
    setShowShareModal(false);
    setCountdown(VRF_MS);
  }, [clearTimers]);

  const isConnected = Boolean(activeAccount);
  const canFlip = (isConnected || isDemo) && phase === 'idle';
  const countdownSec = (countdown / 1000).toFixed(1);
  const countdownMax = isDemo ? DEMO_PENDING_MS : VRF_MS;

  // Map elapsed wait onto 10 "blocks of certainty" — the visual story of consensus.
  const TOTAL_BLOCKS = 10;
  const confirmedBlocks = Math.min(
    TOTAL_BLOCKS,
    Math.max(0, Math.floor(((countdownMax - countdown) / countdownMax) * TOTAL_BLOCKS)),
  );
  // Phase-aware copy turns the dead VRF wait into a narrative beat.
  const waitCopy =
    confirmedBlocks <= 2
      ? { head: 'Bet locked. Coin in the air.', sub: 'Algorand VRF is choosing your fate.' }
      : confirmedBlocks <= 7
        ? {
            head: 'Sealing the outcome.',
            sub: 'The network is the referee — no one can change this.',
          }
        : { head: 'Last block confirming…', sub: 'Hold tight.' };

  const isWin = result?.outcome === 'win';
  const isLoss = result?.outcome === 'loss';

  // Win celebration: confetti burst + payout count-up. Loss: nothing here (handled by the
  // brief red vignette in the render). Keyed on phase+outcome so it fires once per result.
  useEffect(() => {
    if (phase !== 'resolved' || !result) return;
    if (result.outcome === 'win') {
      void confetti({
        particleCount: 130,
        spread: 75,
        origin: { y: 0.5 },
        colors: ['#f5a524', '#ffce6b', '#d98a1f', '#ffe7b0'],
        disableForReducedMotion: true,
      });
      const target =
        result.netPayoutMicroalgo !== null ? Number(result.netPayoutMicroalgo) / 1e6 : 0;
      const start = Date.now();
      const DURATION = 1000;
      let raf = 0;
      const tick = (): void => {
        const t = Math.min(1, (Date.now() - start) / DURATION);
        const eased = 1 - Math.pow(1 - t, 3);
        setDisplayPayout(target * eased);
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    setDisplayPayout(0);
    return undefined;
  }, [phase, result]);

  return (
    <div
      className="flex flex-col gap-6 rounded-lg border p-6"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <h1
        className="text-center text-2xl font-bold tracking-widest uppercase"
        style={{ color: 'var(--color-primary)' }}
      >
        Coinflip
      </h1>

      {/* Idle hero — the coin is alive the moment you land on the page */}
      {(phase === 'idle' || phase === 'error') && (
        <div className="flex items-center justify-center" style={{ minHeight: '8rem' }}>
          <AsciiCoin size="sm" spinning />
        </div>
      )}

      {/* Side picker */}
      <div className="flex gap-3">
        {(['heads', 'tails'] as const).map((side) => (
          <button
            key={side}
            onClick={() => canFlip && setPick(side)}
            disabled={!canFlip}
            className="flex-1 rounded border py-3 text-sm font-semibold uppercase tracking-widest transition-all"
            style={{
              borderColor: pick === side ? 'var(--color-primary)' : 'var(--color-border)',
              background: pick === side ? 'var(--color-primary-dim)' : 'transparent',
              color: pick === side ? 'var(--color-primary)' : 'var(--color-text-muted)',
              cursor: canFlip ? 'pointer' : 'not-allowed',
              opacity: canFlip || pick === side ? 1 : 0.5,
              boxShadow:
                pick === side
                  ? '0 0 0 1px oklch(0.78 0.18 65 / 0.4), 0 0 14px oklch(0.78 0.18 65 / 0.18)'
                  : 'none',
            }}
          >
            {side === 'heads' ? '⬤ Heads' : '○ Tails'}
          </button>
        ))}
      </div>

      {/* Bet amount */}
      <label className="flex flex-col gap-1">
        <span
          className="text-xs uppercase tracking-widest"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Bet (ALGO)
        </span>
        <div
          className="flex items-center rounded border px-3 py-2"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <input
            type="number"
            min={MIN_BET_ALGO}
            max={MAX_BET_ALGO}
            step="0.1"
            value={betAlgo}
            onChange={(e) => setBetAlgo(e.target.value)}
            disabled={!canFlip}
            className="w-full bg-transparent text-right font-mono text-lg outline-none"
            style={{ color: 'var(--color-text)' }}
          />
          <span className="ml-2 text-sm" style={{ color: 'var(--color-text-muted)' }}>
            ALGO
          </span>
        </div>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          + {(Number(BOX_MBR) / 1e6).toFixed(4)} ALGO box deposit (returned on resolve)
        </span>
      </label>

      {/* Flip button */}
      {phase === 'idle' || phase === 'error' ? (
        <button
          onClick={isDemo ? handleDemoFlip : handleFlip}
          disabled={!canFlip}
          className="rounded border py-4 text-base font-bold uppercase tracking-widest transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            borderColor: 'var(--color-primary)',
            background: 'var(--color-primary-dim)',
            color: 'var(--color-primary)',
          }}
        >
          {!isConnected && !isDemo ? 'Connect wallet to play' : isDemo ? 'Flip (demo)' : 'Flip'}
        </button>
      ) : null}

      {/* Signing state */}
      {phase === 'signing' && (
        <div className="py-4 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Approve in your wallet…
        </div>
      )}

      {/* VRF pending — the coin is in the air, consensus is the referee */}
      {phase === 'pending' && (
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="flex items-center justify-center" style={{ minHeight: '11rem' }}>
            <AsciiCoin size="lg" spinning />
          </div>
          <div className="text-center">
            <div
              className="text-sm font-bold uppercase tracking-widest"
              style={{ color: 'var(--color-vrf)' }}
            >
              {waitCopy.head}
            </div>
            <div className="mt-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {waitCopy.sub}
            </div>
          </div>
          {/* Ten blocks of certainty filling toward the reveal */}
          <div className="flex gap-2">
            {Array.from({ length: TOTAL_BLOCKS }).map((_, i) => (
              <span
                key={i}
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: i < confirmedBlocks ? 'var(--color-vrf)' : 'var(--color-border)',
                  boxShadow: i < confirmedBlocks ? '0 0 8px var(--color-vrf)' : 'none',
                  transform: i === confirmedBlocks - 1 ? 'scale(1.4)' : 'scale(1)',
                  transition: 'all 0.35s ease',
                }}
              />
            ))}
          </div>
          <div
            className="font-mono text-xs tabular-nums"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {confirmedBlocks}/{TOTAL_BLOCKS} blocks · {countdownSec}s{isDemo ? ' · demo' : ''}
          </div>
        </div>
      )}

      {/* Result */}
      {phase === 'resolved' && result && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="flex items-center justify-center" style={{ minHeight: '11rem' }}>
            <AsciiCoin
              size="lg"
              spinning={false}
              result={result.outcome === 'win' ? 'win' : result.outcome === 'loss' ? 'loss' : null}
            />
          </div>
          {/* Brief red screen-edge flash on a loss, then it fades itself out */}
          {isLoss && <div className="loss-vignette" />}

          <motion.div
            key={result.outcome}
            initial={isWin ? { scale: 0.7, opacity: 0 } : { x: -10, opacity: 0 }}
            animate={
              isWin
                ? {
                    scale: 1,
                    opacity: 1,
                    transition: { type: 'spring', stiffness: 420, damping: 18 },
                  }
                : { x: 0, opacity: 1, transition: { duration: 0.18 } }
            }
            className="flex flex-col items-center gap-2"
          >
            <div
              className="text-2xl font-bold uppercase tracking-widest"
              style={{
                color: isWin
                  ? 'var(--color-win)'
                  : isLoss
                    ? 'var(--color-lose)'
                    : 'var(--color-primary)',
              }}
            >
              {isWin
                ? `${result.playerPick === 'heads' ? 'Heads' : 'Tails'} — You Won`
                : isLoss
                  ? `${result.playerPick === 'heads' ? 'Heads' : 'Tails'} — You Lost`
                  : result.outcome === 'refunded'
                    ? 'Refunded'
                    : result.outcome}
            </div>
            {isWin && result.netPayoutMicroalgo !== null && (
              <div className="font-mono text-lg tabular-nums" style={{ color: 'var(--color-win)' }}>
                +{displayPayout.toFixed(4)} ALGO
              </div>
            )}
          </motion.div>

          <div className="flex gap-3">
            {result.proofCardUrl && (
              <button
                onClick={() => setShowShareModal(true)}
                className="rounded border px-4 py-2 text-sm font-semibold uppercase tracking-wide transition-opacity hover:opacity-80"
                style={{
                  borderColor: 'var(--color-vrf)',
                  color: 'var(--color-vrf)',
                  background: 'var(--color-vrf-dim)',
                }}
              >
                Share Proof Card
              </button>
            )}
            <button
              onClick={reset}
              className="rounded border px-4 py-2 text-sm font-semibold uppercase tracking-wide transition-opacity hover:opacity-80"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
            >
              Play Again
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && error && (
        <div
          className="rounded border px-4 py-3 text-sm"
          style={{
            borderColor: 'var(--color-lose)',
            color: 'var(--color-lose)',
            background: 'var(--color-lose-dim)',
          }}
        >
          {error}
        </div>
      )}

      {/* Proof card share modal */}
      {showShareModal && result?.proofCardUrl && (
        <ProofCardModal
          proofCardUrl={result.proofCardUrl}
          txnId={result.txnId}
          outcome={result.outcome}
          playerPick={result.playerPick}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ProofCardModalProps {
  proofCardUrl: string;
  txnId: string | null;
  outcome: BetOutcome;
  playerPick: CoinSide;
  onClose: () => void;
}

function ProofCardModal({
  proofCardUrl,
  txnId,
  outcome,
  playerPick,
  onClose,
}: ProofCardModalProps) {
  const side = playerPick === 'heads' ? 'heads' : 'tails';
  const shareText =
    outcome === 'win'
      ? `Just hit ${side} on Fairground — provably fair coinflip on Algorand. VRF proof attached.`
      : `Got ${side} on Fairground. Provably fair, verifiable on-chain. Next one's mine.`;
  const twitterIntent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(proofCardUrl)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(26,21,18,0.92)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex w-full max-w-lg flex-col gap-4 rounded-lg border p-6"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center justify-between">
          <span
            className="text-sm font-semibold uppercase tracking-widest"
            style={{ color: 'var(--color-vrf)' }}
          >
            VRF Proof Card
          </span>
          <button
            onClick={onClose}
            className="text-lg leading-none transition-opacity hover:opacity-60"
            style={{ color: 'var(--color-text-muted)' }}
          >
            ×
          </button>
        </div>

        {/* Proof card image */}
        <img
          src={proofCardUrl}
          alt="VRF proof card"
          className="w-full rounded border"
          style={{ borderColor: 'var(--color-border)' }}
        />

        <div className="flex flex-col gap-2">
          <a
            href={twitterIntent}
            target="_blank"
            rel="noopener noreferrer"
            className="block rounded border py-3 text-center text-sm font-semibold uppercase tracking-widest transition-opacity hover:opacity-80"
            style={{
              borderColor: 'var(--color-primary)',
              color: 'var(--color-primary)',
              background: 'var(--color-primary-dim)',
            }}
          >
            Share on X / Twitter
          </a>

          {txnId && (
            <a
              href={`https://allo.info/tx/${txnId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-xs transition-opacity hover:opacity-70"
              style={{ color: 'var(--color-text-muted)' }}
            >
              View on Allo →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
