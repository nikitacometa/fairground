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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { motion, useAnimate } from 'motion/react';
import confetti from 'canvas-confetti';
import { useScramble } from 'use-scramble';
import { isValidAddress } from 'algosdk';

// Win burst palette — amber with a single green accent for the "you won" pop.
const WIN_COLORS = ['#f5a524', '#ffce6b', '#d98a1f', '#ffe7b0', '#6fe06a'];
import { fetchBetState, recordBet } from '../lib/api';
import { sendFlip } from '../lib/coinflip';
import { AsciiCoin } from './AsciiCoin';
import { CoinTossScene } from './CoinTossScene';
import { useRelayerWake } from './useRelayerWake';
import { sfx, setMuted, primeAudio } from '../lib/sfx';
import { oracleSequence } from '../lib/oracle';
import { WalletName } from '@fairground/nfd/react';
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
const VRF_MS = VRF_ROUNDS * MS_PER_ROUND; // ~33 600ms — the bar's full duration
// Begin polling well before the bar completes, then poll fast, so the result is revealed
// within ~1.5s of the on-chain resolution instead of stalling at "0" for several seconds.
const FIRST_POLL_MS = Math.round(BEACON_DELAY * MS_PER_ROUND * 0.8); // ~18s
const POLL_INTERVAL_MS = 1500;
const POLL_RETRY_MS = 2500;

type CoinSide = 'heads' | 'tails';
type GamePhase = 'idle' | 'signing' | 'pending' | 'resolved' | 'error';

interface ResolvedResult {
  outcome: BetOutcome;
  /** The side the player chose — used to render the outcome label correctly. */
  playerPick: CoinSide;
  netPayoutMicroalgo: bigint | null;
  proofCardUrl: string | null;
  txnId: string | null;
  /** The wallet that placed this bet — captured at resolve so a later disconnect/switch can't
   *  misattribute the referral link in the share card. */
  walletAddress: string | null;
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
  // Which of the 10 toss animations plays during the VRF wait (random per flip).
  const [tossVariant, setTossVariant] = useState(0);
  // Per-flip seed (the commit round) that deterministically curates the Terminal Oracle lines.
  const [flipSeed, setFlipSeed] = useState(0n);
  // Consecutive-win streak (persisted per wallet). Drives the "STREAK AT RISK" tension during the
  // wait and the proof-card flair. Hydrated from localStorage on connect; updated on each resolve.
  const [streak, setStreak] = useState(0);
  // Queue-the-next-flip: stage the next bet while this one resolves so there is no idle decision
  // gap between rounds. On resolve, the queued bet auto-fires after the reveal. `armed` bridges the
  // state update (pick/bet) and the fire so handleFlip reads the fresh values.
  const [queued, setQueued] = useState<{ side: CoinSide; amount: string } | null>(null);
  const [armed, setArmed] = useState(false);
  // Referrer wallet from a `?ref=<address>` link (proof-card QR). Validated; paid 0.5% of
  // the stake on-chain by the contract. Null when absent/invalid/self-referral.
  const [referrer, setReferrer] = useState<string | null>(null);
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref && isValidAddress(ref)) setReferrer(ref);
  }, []);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // motion scope for the reveal screen-shake (attached to the game panel).
  const [scope, animate] = useAnimate();
  // SFX mute (persisted). Audio only ever starts on a user gesture.
  const [muted, setMutedUi] = useState(false);
  useEffect(() => {
    const stored = typeof window !== 'undefined' && localStorage.getItem('fg_sfx_muted') === '1';
    setMutedUi(stored);
    setMuted(stored);
  }, []);
  const toggleMute = useCallback(() => {
    setMutedUi((m) => {
      const next = !m;
      setMuted(next);
      try {
        localStorage.setItem('fg_sfx_muted', next ? '1' : '0');
      } catch {
        // ignore storage failures (private mode) — mute still applies for the session
      }
      return next;
    });
  }, []);

  // Hydrate the win streak for the connected wallet (persisted across sessions).
  useEffect(() => {
    const addr = activeAccount?.address;
    if (!addr) {
      setStreak(0);
      return;
    }
    try {
      const stored = localStorage.getItem(`fg_streak_${addr}`);
      setStreak(stored ? Math.max(0, parseInt(stored, 10) || 0) : 0);
    } catch {
      setStreak(0);
    }
  }, [activeAccount?.address]);

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
    (sid: string, playerPick: CoinSide, bettor: string) => {
      const attempt = async () => {
        try {
          const state = await fetchBetState(sid);
          if (state.outcome !== 'pending') {
            clearTimers();
            setResult({
              outcome: state.outcome,
              playerPick,
              walletAddress: bettor,
              netPayoutMicroalgo: state.netPayoutMicroalgo,
              proofCardUrl: state.proofCardUrl,
              txnId: state.txnId,
            });
            setPhase('resolved');
            setShowShareModal(true);
          } else {
            pollRef.current = setTimeout(() => void attempt(), POLL_INTERVAL_MS);
          }
        } catch {
          // Transient error — keep polling
          pollRef.current = setTimeout(() => void attempt(), POLL_RETRY_MS);
        }
      };
      pollRef.current = setTimeout(() => void attempt(), FIRST_POLL_MS);
    },
    [clearTimers],
  );

  const handleFlip = useCallback(async () => {
    if (!activeAccount) return;
    setError(null);
    setTossVariant(Math.floor(Math.random() * 10));
    setPhase('signing');
    primeAudio();
    sfx.toss();
    window.setTimeout(() => sfx.clink(), 340);

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
        referrer: referrer && referrer !== activeAccount.address ? referrer : null,
      });

      // Register the pending session so the keeper resolves it and the UI can poll.
      const { sessionId: sid } = await recordBet({
        walletAddress: activeAccount.address,
        txnId,
        commitRound,
        saltHash,
        betMicroalgo,
      });

      setFlipSeed(commitRound);
      setPhase('pending');
      startCountdown();
      pollResolution(sid, pick, activeAccount.address);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [activeAccount, betAlgo, pick, transactionSigner, referrer, startCountdown, pollResolution]);

  // Wallet-free walkthrough: runs the full visual flow (sign → VRF wait → reveal) with a
  // forced outcome and a shortened wait, so the experience can be shown without a chain hit.
  const handleDemoFlip = useCallback(() => {
    if (!demoOutcome) return;
    setError(null);
    setTossVariant(Math.floor(Math.random() * 10));
    setFlipSeed(BigInt(Math.floor(Math.random() * 1_000_000_000)));
    setPhase('signing');
    primeAudio();
    sfx.toss();
    window.setTimeout(() => sfx.clink(), 340);
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
          walletAddress: null,
          netPayoutMicroalgo: demoOutcome === 'win' ? (betMicroalgo * 2n * 9700n) / 10000n : null,
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
    setQueued(null);
    setArmed(false);
  }, [clearTimers]);

  // Mouse-tracked amber spotlight on the panel (no-op on touch — pointer never moves).
  const handlePanelMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, []);

  // Hydration guard: Pera/Defly resume their session synchronously from localStorage, so the
  // client's first paint sees activeAccount while the server rendered none. Treat the wallet as
  // disconnected until mounted so SSR and the first client render agree (avoids #418), then the
  // real connected state swaps in after hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const isConnected = mounted && Boolean(activeAccount);
  // 'error' stays interactive: a rejected bet (e.g. over max) must let the player edit and
  // retry without reloading. handleFlip clears the error on the next attempt.
  const canFlip = (isConnected || isDemo) && (phase === 'idle' || phase === 'error');
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
      ? {
          head: 'Bet committed. The coin is in the air.',
          sub: 'Algorand VRF is selecting the outcome. You cannot influence it.',
        }
      : confirmedBlocks <= 7
        ? {
            head: 'Sealing the outcome.',
            sub: 'The network is the referee. This cannot be altered — including by us.',
          }
        : { head: 'Consensus imminent.', sub: 'Do not refresh. The outcome already exists.' };

  const isWin = result?.outcome === 'win';
  const isLoss = result?.outcome === 'loss';

  // Win celebration: confetti burst + payout count-up. Loss: nothing here (handled by the
  // brief red vignette in the render). Keyed on phase+outcome so it fires once per result.
  useEffect(() => {
    if (phase !== 'resolved' || !result) return;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Outcome sound (mute-gated inside the engine).
    if (result.outcome === 'win') sfx.win();
    else if (result.outcome === 'loss') sfx.loss();

    // Update + persist the win streak: a win extends it, a loss resets it. Keyed on the bettor
    // captured at flip time (result.walletAddress), NOT the live wallet — so a disconnect/switch
    // while the flip resolves can't credit or reset the wrong account.
    if (result.outcome === 'win' || result.outcome === 'loss') {
      const bettor = result.walletAddress;
      if (bettor) {
        let prevStored: number;
        try {
          prevStored = Math.max(
            0,
            parseInt(localStorage.getItem(`fg_streak_${bettor}`) ?? '0', 10) || 0,
          );
        } catch {
          prevStored = 0;
        }
        const next = result.outcome === 'win' ? prevStored + 1 : 0;
        try {
          localStorage.setItem(`fg_streak_${bettor}`, String(next));
        } catch {
          // ignore storage failures (private mode) — streak still updates for the session
        }
        // Reflect in the live UI only while the bettor is still the connected wallet.
        if (bettor === activeAccount?.address) setStreak(next);
      } else {
        // Demo flips have no wallet — keep an in-memory streak so the mechanic is visible.
        setStreak((prev) => (result.outcome === 'win' ? prev + 1 : 0));
      }
    }

    // Screen-shake the panel on the reveal (sharp on a win, a brief jolt on a loss).
    if (!reduce && scope.current) {
      void animate(
        scope.current,
        { x: result.outcome === 'win' ? [0, -7, 8, -6, 5, -3, 0] : [0, -4, 4, -2, 0] },
        { duration: result.outcome === 'win' ? 0.4 : 0.3, ease: 'easeOut' },
      );
    }

    if (result.outcome === 'win') {
      // Two-wave amber star burst.
      void confetti({
        particleCount: 90,
        spread: 72,
        startVelocity: 34,
        origin: { y: 0.45 },
        shapes: ['star', 'circle'],
        scalar: 1.1,
        colors: WIN_COLORS,
        disableForReducedMotion: true,
      });
      const secondWave = setTimeout(() => {
        void confetti({
          particleCount: 60,
          spread: 110,
          startVelocity: 42,
          origin: { y: 0.5 },
          shapes: ['star'],
          scalar: 0.9,
          colors: WIN_COLORS,
          disableForReducedMotion: true,
        });
      }, 170);

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
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(secondWave);
      };
    }
    setDisplayPayout(0);
    return undefined;
  }, [phase, result, animate, scope]);

  // Queue auto-advance: once a flip resolves with a next flip queued, fire it after a short
  // reveal window so the player sees the result, then the staged bet auto-submits. No idle gap.
  useEffect(() => {
    if (phase !== 'resolved' || !queued) return;
    const t = setTimeout(() => {
      setPick(queued.side);
      setBetAlgo(queued.amount);
      reset(); // clears queued + returns to idle
      setArmed(true); // fire on the next idle render (handleFlip reads the fresh pick/bet)
    }, 2800);
    return () => clearTimeout(t);
  }, [phase, queued, reset]);

  // Fire the armed (queued) flip once we are back to idle with the staged pick/bet committed.
  useEffect(() => {
    if (!armed || phase !== 'idle') return;
    setArmed(false);
    if (isDemo) handleDemoFlip();
    else if (isConnected) void handleFlip();
  }, [armed, phase, isDemo, isConnected, handleDemoFlip, handleFlip]);

  return (
    <div
      ref={scope}
      className="fg-panel flex flex-col gap-6 border p-6"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      onMouseMove={handlePanelMove}
    >
      <button
        onClick={toggleMute}
        aria-label={muted ? 'Unmute sound' : 'Mute sound'}
        className="absolute right-3 top-3 z-10 font-mono text-xs transition-opacity hover:opacity-100"
        style={{ color: 'var(--color-text-muted)', opacity: muted ? 0.4 : 0.7 }}
      >
        {muted ? '[x]' : '[♪]'}
      </button>
      <div className="text-center">
        <h1
          className="text-2xl font-bold tracking-[0.35em] uppercase"
          style={{ color: 'var(--color-primary)' }}
        >
          Coinflip
        </h1>
        <div
          className="mt-2 font-mono text-[10px] uppercase tracking-[0.3em]"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <span style={{ color: 'var(--color-win)' }}>●</span> {NETWORK ?? 'algorand'} ·
          provably-fair vrf
        </div>
      </div>

      {streak >= 1 && phase !== 'pending' && (
        <div
          className="text-center font-mono text-[11px] uppercase tracking-[0.3em]"
          style={{ color: streak >= 3 ? 'var(--color-primary)' : 'var(--color-text-dim)' }}
        >
          ◇ {streak} win streak{streak >= 5 ? ' · untouchable' : ''}
        </div>
      )}

      {referrer && (
        <div
          className="flex items-center justify-center gap-1.5 text-center font-mono text-[10px] uppercase tracking-[0.25em]"
          style={{ color: 'var(--color-win)' }}
        >
          ◆ referred by{' '}
          <WalletName
            address={referrer}
            nfdColor="var(--color-primary)"
            addrColor="var(--color-win)"
          />{' '}
          · earns 0.5% of the rake
        </div>
      )}

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
            onClick={() => {
              if (!canFlip) return;
              sfx.tick();
              setPick(side);
            }}
            disabled={!canFlip}
            className="fg-btn flex-1 border py-3 text-sm font-semibold uppercase tracking-widest"
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
          className="flex items-center border px-3 py-2"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <input
            type="number"
            min={MIN_BET_ALGO}
            max={MAX_BET_ALGO}
            step="0.1"
            value={betAlgo}
            onChange={(e) => {
              setBetAlgo(e.target.value);
              if (phase === 'error') {
                setPhase('idle');
                setError(null);
              }
            }}
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
          className="fg-btn fg-btn-primary fg-conic py-4 text-base font-bold uppercase tracking-[0.2em] disabled:cursor-not-allowed disabled:opacity-40"
          style={{ color: 'var(--color-primary)' }}
        >
          {!isConnected && !isDemo ? (
            'Connect wallet to play'
          ) : (
            <>
              <span style={{ opacity: 0.45 }}>[</span> {isDemo ? 'Flip // Demo' : 'Flip'}{' '}
              <span className="cursor-blink">_</span>
              <span style={{ opacity: 0.45 }}>]</span>
            </>
          )}
        </button>
      ) : null}

      {/* Signing state */}
      {phase === 'signing' && <AsciiSpinner label="Awaiting signature" />}

      {/* VRF pending — the coin is in the air, consensus is the referee */}
      {phase === 'pending' && (
        <div className="flex flex-col items-center gap-4 py-2">
          <div className="flex items-center justify-center" style={{ minHeight: '15rem' }}>
            <CoinTossScene variant={tossVariant} />
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
            {streak >= 3 && (
              <div
                className="mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.3em]"
                style={{ color: 'var(--color-primary)' }}
              >
                ◇ streak at risk · {streak}
              </div>
            )}
          </div>
          {/* Ten blocks of certainty filling toward the reveal */}
          <BlockBar
            filled={confirmedBlocks}
            total={TOTAL_BLOCKS}
            seconds={countdownSec}
            demo={isDemo}
          />
          {/* The protocol mutters while you wait — fresh deadpan line every few seconds */}
          <TerminalOracle seed={flipSeed} />

          {/* Queue the next flip — stage it now, it auto-fires after the reveal (no idle gap) */}
          {queued ? (
            <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.2em]">
              <span style={{ color: 'var(--color-primary)' }}>
                ↻ queued · {queued.side} · {queued.amount}
              </span>
              <button
                onClick={() => setQueued(null)}
                className="transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-text-muted)' }}
              >
                [ cancel ]
              </button>
            </div>
          ) : (
            <button
              onClick={() => setQueued({ side: pick, amount: betAlgo })}
              className="border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] transition-opacity hover:opacity-80"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}
            >
              ↻ queue next flip
            </button>
          )}
        </div>
      )}

      {/* Result */}
      {phase === 'resolved' && result && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="relative flex items-center justify-center" style={{ minHeight: '11rem' }}>
            {isWin && <div className="shockwave" />}
            {isLoss && <div className="shockwave is-loss" />}
            <AsciiCoin
              size="lg"
              spinning={false}
              result={result.outcome === 'win' ? 'win' : result.outcome === 'loss' ? 'loss' : null}
            />
          </div>
          {/* Brief radial flash on a win; red screen-edge vignette on a loss. */}
          {isWin && <div className="win-flash" />}
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
            <ScrambleText
              className="glitch-label text-2xl font-bold uppercase tracking-widest"
              style={{
                color: isWin
                  ? 'var(--color-win)'
                  : isLoss
                    ? 'var(--color-lose)'
                    : 'var(--color-primary)',
              }}
              text={
                isWin
                  ? `${result.playerPick === 'heads' ? 'Heads' : 'Tails'} — You Won`
                  : isLoss
                    ? `${result.playerPick === 'heads' ? 'Heads' : 'Tails'} — You Lost`
                    : result.outcome === 'refunded'
                      ? 'Refunded'
                      : result.outcome
              }
            />
            {isLoss && (
              <div
                className="font-mono text-xs"
                style={{ color: 'var(--color-text-muted)', opacity: 0.85 }}
              >
                // sha-256 was correct. you were not.
              </div>
            )}
            {isWin && result.netPayoutMicroalgo !== null && (
              <div
                className="payout-slam phosphor-win font-mono text-3xl font-bold tabular-nums"
                style={{ color: 'var(--color-win)' }}
              >
                +{displayPayout.toFixed(4)} ALGO
              </div>
            )}
          </motion.div>

          <div className="flex gap-3">
            {result.proofCardUrl && (
              <button
                onClick={() => setShowShareModal(true)}
                className="fg-btn border px-4 py-2 text-sm font-semibold uppercase tracking-wide hover:opacity-80"
                style={{
                  borderColor: 'var(--color-vrf)',
                  color: 'var(--color-vrf)',
                  background: 'var(--color-vrf-dim)',
                }}
              >
                [ Share Proof Card ]
              </button>
            )}
            <button
              onClick={reset}
              className="fg-btn border px-4 py-2 text-sm font-semibold uppercase tracking-wide hover:opacity-80"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
            >
              {isLoss ? '[ Accept result // play again ]' : '[ Play Again ]'}
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {phase === 'error' && error && (
        <div
          className="border px-4 py-3 font-mono text-sm"
          style={{
            borderColor: 'var(--color-lose)',
            color: 'var(--color-lose)',
            background: 'var(--color-lose-dim)',
          }}
        >
          <span style={{ opacity: 0.6 }}>! </span>
          {error}
          <div className="mt-1 font-mono text-xs" style={{ opacity: 0.55 }}>
            // your funds were not wagered. the chain is fine.
          </div>
        </div>
      )}

      {/* Proof card share modal */}
      {showShareModal && result?.proofCardUrl && (
        <ProofCardModal
          proofCardUrl={result.proofCardUrl}
          txnId={result.txnId}
          outcome={result.outcome}
          playerPick={result.playerPick}
          walletAddress={result.walletAddress}
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
  walletAddress: string | null;
  onClose: () => void;
}

function ProofCardModal({
  proofCardUrl,
  txnId,
  outcome,
  playerPick,
  walletAddress,
  onClose,
}: ProofCardModalProps) {
  const [cardRevealed, setCardRevealed] = useState(false);
  const side = playerPick === 'heads' ? 'heads' : 'tails';
  const shareText =
    outcome === 'win'
      ? `Just hit ${side} on Fairground — provably fair coinflip on Algorand. VRF proof attached.`
      : `Got ${side} on Fairground. Provably fair, verifiable on-chain. Next one's mine.`;
  // The tweet must link to the GAME (playable + referral-attributed), NOT the raw proof PNG —
  // a click on the PNG is a dead end. The `?proof=` param makes the game's generateMetadata serve
  // this exact card as the tweet's large-image preview, so the card still shows in the tweet while
  // the link lands a recruit on the game under the sharer's referral.
  const gameParams = new URLSearchParams();
  if (walletAddress) gameParams.set('ref', walletAddress);
  if (txnId) gameParams.set('proof', txnId);
  // Link to THIS deployment's origin (so testnet/staging/local shares don't point at prod).
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://app.fairground.quest';
  const playLink = `${origin}/?${gameParams.toString()}`;
  const twitterIntent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(playLink)}&via=FairgroundHQ`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(26,21,18,0.92)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex w-full max-w-lg flex-col gap-4 border p-6"
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
          onLoad={() => requestAnimationFrame(() => setCardRevealed(true))}
          className={`proof-wipe w-full border${cardRevealed ? ' revealed' : ''}`}
          style={{ borderColor: 'var(--color-border)' }}
        />

        <div className="flex flex-col gap-2">
          <a
            href={twitterIntent}
            target="_blank"
            rel="noopener noreferrer"
            className="fg-btn block border py-3 text-center text-sm font-semibold uppercase tracking-widest hover:opacity-80"
            style={{
              borderColor: 'var(--color-primary)',
              color: 'var(--color-primary)',
              background: 'var(--color-primary-dim)',
            }}
          >
            [ Share on X ]
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

// The Terminal Oracle — deadpan protocol mutterings typed out during the VRF wait. A fresh,
// deterministic line (seeded by the commit round) every ~8.5s, so there is always something new
// to read while the coin tumbles — dead wait time becomes curated, screenshot-able character.
function TerminalOracle({ seed }: { seed: bigint }) {
  const lines = useMemo(() => oracleSequence(seed, 4), [seed]);
  const [idx, setIdx] = useState(0);
  const [typed, setTyped] = useState('');

  // Advance to the next line on an interval (wraps).
  useEffect(() => {
    setIdx(0);
    const t = setInterval(() => setIdx((i) => (i + 1) % lines.length), 8500);
    return () => clearInterval(t);
  }, [lines]);

  // Typewriter the current line, char by char.
  useEffect(() => {
    const line = lines[idx] ?? '';
    setTyped('');
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setTyped(line.slice(0, i));
      if (i >= line.length) clearInterval(t);
    }, 24);
    return () => clearInterval(t);
  }, [idx, lines]);

  return (
    <div
      aria-live="polite"
      className="min-h-[2.75rem] max-w-sm px-2 text-center font-mono text-[11px] leading-relaxed"
      style={{ color: 'var(--color-text-dim)' }}
    >
      <span style={{ opacity: 0.45 }}>{'> '}</span>
      {typed}
      <span className="cursor-blink" style={{ opacity: 0.7 }}>
        _
      </span>
    </div>
  );
}

// Outcome label that decodes from scrambled glyphs on mount — the VRF result resolving
// out of randomness. Auto-plays once (use-scramble replays whenever `text` changes).
function ScrambleText({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { ref } = useScramble({
    text,
    speed: 0.5,
    tick: 1,
    step: 2,
    scramble: 6,
    seed: 2,
    overflow: true,
  });
  return <span ref={ref} className={className} style={style} />;
}

const SPINNER_FRAMES = ['|', '/', '-', '\\'] as const;

// A spinning ASCII glyph (| / - \) + label — the "awaiting signature" state as a terminal
// process rather than a friendly sentence.
function AsciiSpinner({ label }: { label: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), 110);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      className="py-4 text-center font-mono text-sm uppercase tracking-[0.25em]"
      style={{ color: 'var(--color-vrf)' }}
    >
      <span style={{ color: 'var(--color-text-muted)' }}>[ </span>
      <span
        style={{ display: 'inline-block', width: '1ch', textShadow: '0 0 8px var(--color-vrf)' }}
      >
        {SPINNER_FRAMES[frame]}
      </span>
      <span style={{ color: 'var(--color-text-muted)' }}> ] </span>
      {label}
    </div>
  );
}

// Monospace block-progress bar: [████████░░] 8/10 BLOCKS · 5.4s. Reads as on-chain
// consensus filling in, which is exactly what the VRF wait is.
function BlockBar({
  filled,
  total,
  seconds,
  demo,
}: {
  filled: number;
  total: number;
  seconds: string;
  demo?: boolean;
}) {
  return (
    <div className="font-mono text-base tabular-nums" style={{ letterSpacing: '0.1em' }}>
      <span style={{ color: 'var(--color-text-muted)' }}>[</span>
      <span style={{ color: 'var(--color-vrf)', textShadow: '0 0 8px var(--color-vrf)' }}>
        {'█'.repeat(filled)}
      </span>
      <span style={{ color: 'var(--color-border)' }}>
        {'░'.repeat(Math.max(0, total - filled))}
      </span>
      <span style={{ color: 'var(--color-text-muted)' }}>]</span>
      <span
        className="ml-3 text-xs uppercase tracking-widest"
        style={{ color: 'var(--color-text-muted)' }}
      >
        {filled}/{total} blocks · {seconds}s{demo ? ' · demo' : ''}
      </span>
    </div>
  );
}
