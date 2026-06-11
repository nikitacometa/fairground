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
import {
  beaconTaps,
  fetchActiveFlip,
  fetchBetState,
  fetchFairPoints,
  fetchStreak,
  recordBet,
  sendTaps,
} from '../lib/api';
import { sendFlip } from '../lib/coinflip';
import {
  fetchFlipBox,
  findFlipTxnId,
  isIndeterminateNetworkError,
  type OnChainFlipBox,
} from '../lib/chainRecovery';
import { Coin3DWrapper } from './Coin3DWrapper';
import type { CoinVariant } from './Coin3D';
import { TapCoinField } from './FairTaps';
import { TAP_CAP, FLIP_POINTS, bankedTapPoints, clientGoldenIndex } from '../lib/fairPoints';
import { useRelayerWake } from './useRelayerWake';

// Queue-the-next-flip: staged for a later release. The implementation (state + auto-fire) is kept
// intact but gated off here so the pending screen stays uncluttered — flip this to re-enable.
const QUEUE_ENABLED = false;
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

// Display ALGO with at most 3 decimals and no trailing zeros: 36.1 not 36.1000.
function formatAlgo(n: number): string {
  return parseFloat(n.toFixed(3)).toString();
}

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

// `fundsSafe` distinguishes a PRE-commit failure (sign rejected, bet out of range — the stake was
// never wagered) from a POST-commit failure (the flip IS on-chain; only a follow-up call failed —
// never claim the funds are untouched).
interface FlipError {
  message: string;
  fundsSafe: boolean;
  hint?: string;
}

// A flip that confirmed on-chain but may not have been registered with the keeper (the API was
// unreachable, or the tab closed mid-flight). Persisted per wallet so a reload can re-register it
// (recordBet is idempotent) and resume polling — otherwise the keeper never sees it.
interface PendingFlipRecord {
  txnId: string;
  commitRound: string;
  saltHash: string; // hex
  /** The salt PREIMAGE (hex) — bettor-only proof for FAIR tap writes. Absent on pre-clicker
   *  records; recovery then resumes the flip with the clicker off. */
  salt?: string;
  betMicroalgo: string;
  pick: CoinSide;
  referrer: string | null;
}

const pendingFlipKey = (addr: string): string => `fg_pending_flip_${addr}`;

// A flip whose signature was REQUESTED but whose submit outcome is unknown. Persisted BEFORE
// the wallet hand-off (iOS Safari can kill the page's fetches during the app-switch), so a
// "Load failed" mid-submit — or a closed tab — can later check the chain and resume the flip
// instead of losing it. Upgraded to a PendingFlipRecord once the txn is confirmed.
interface DraftFlipRecord {
  salt: string; // preimage hex — tap-write proof + box identity check
  saltHash: string; // hex
  betMicroalgo: string;
  pick: CoinSide;
  referrer: string | null;
  createdAt: number;
}

const draftFlipKey = (addr: string): string => `fg_draft_flip_${addr}`;

function persistDraftFlip(addr: string, rec: DraftFlipRecord): void {
  try {
    localStorage.setItem(draftFlipKey(addr), JSON.stringify(rec));
  } catch {
    // private-mode / quota: draft recovery just won't be available
  }
}
function clearDraftFlip(addr: string): void {
  try {
    localStorage.removeItem(draftFlipKey(addr));
  } catch {
    // ignore storage failures
  }
}
function readDraftFlip(addr: string): DraftFlipRecord | null {
  try {
    const raw = localStorage.getItem(draftFlipKey(addr));
    return raw ? (JSON.parse(raw) as DraftFlipRecord) : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function persistPendingFlip(addr: string, rec: PendingFlipRecord): void {
  try {
    localStorage.setItem(pendingFlipKey(addr), JSON.stringify(rec));
  } catch {
    // private-mode / quota: recovery just won't be available; the on-chain flip is unaffected.
  }
}
function clearPendingFlip(addr: string): void {
  try {
    localStorage.removeItem(pendingFlipKey(addr));
  } catch {
    // ignore storage failures
  }
}
function readPendingFlip(addr: string): PendingFlipRecord | null {
  try {
    const raw = localStorage.getItem(pendingFlipKey(addr));
    return raw ? (JSON.parse(raw) as PendingFlipRecord) : null;
  } catch {
    return null;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Demo mode: a shortened VRF wait so the wallet-free walkthrough resolves quickly.
// `?wait=<ms>` overrides it (demo only) — used for visual QA of the pending-phase clicker.
const DEMO_PENDING_MS = 3600;
function demoPendingMs(): number {
  try {
    const w = parseInt(new URLSearchParams(window.location.search).get('wait') ?? '', 10);
    return Number.isFinite(w) && w >= 500 && w <= 120_000 ? w : DEMO_PENDING_MS;
  } catch {
    return DEMO_PENDING_MS;
  }
}

export function CoinflipGame({ demoOutcome }: { demoOutcome?: 'win' | 'loss' | null } = {}) {
  const isDemo = Boolean(demoOutcome);
  const { activeAccount, transactionSigner } = useWallet();
  const [pick, setPick] = useState<CoinSide>('heads');
  const [betAlgo, setBetAlgo] = useState(MIN_BET_ALGO.toString());
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [error, setError] = useState<FlipError | null>(null);
  const [countdown, setCountdown] = useState(VRF_MS);
  // Demo wait duration (overridable via ?wait= for visual QA) — drives the demo block bar.
  const [demoWaitMs, setDemoWaitMs] = useState(DEMO_PENDING_MS);
  const [result, setResult] = useState<ResolvedResult | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  // Animated count-up of the win payout (microALGO -> ALGO), purely cosmetic.
  const [displayPayout, setDisplayPayout] = useState(0);
  // The WebGL coin (coop heads / Algorand tails) is the one and only coin. The old 3D/ASCII toggle
  // and the face swapper are gone — this is the signature coin now. The ASCII coin survives only as
  // the WebGL fallback inside Coin3DWrapper for browsers that cannot run WebGL.
  const coinVariant: CoinVariant = 'coop';
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
  // Referrer wallet from a `?ref=<address>` link (proof-card QR). Validated; paid 1% of
  // the stake on-chain by the contract. Null when absent/invalid/self-referral.
  const [referrer, setReferrer] = useState<string | null>(null);
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref && isValidAddress(ref)) setReferrer(ref);
  }, []);

  // ---- FAIR points clicker (docs/design/fair-points-v1.md) ----
  // Session = one flip's seal wait. The raw tap count lives in a ref (read by the flush
  // interval without re-subscribing) and is mirrored to state for the result screen.
  const [tapSessionId, setTapSessionId] = useState<string | null>(null);
  // The flip's salt preimage (hex) — the bettor-only proof for tap writes. Null = this
  // client cannot bank taps (e.g. a flip recovered via /active on a different device) —
  // the clicker stays off rather than showing points that would never count.
  const [tapSalt, setTapSalt] = useState<string | null>(null);
  const [tapGolden, setTapGolden] = useState<number | null>(null);
  const [tapRaw, setTapRaw] = useState(0);
  const [tapPrime, setTapPrime] = useState(0);
  const tapRawRef = useRef(0);
  const tapSentRef = useRef(0);
  const tapSessionRef = useRef<string | null>(null);
  // Lifetime FAIR total for the connected wallet (the idle chip). Null = unknown/none.
  const [fairTotal, setFairTotal] = useState<number | null>(null);

  const handleTapCount = useCallback((raw: number) => {
    tapRawRef.current = raw;
    setTapRaw(raw);
  }, []);

  // Arm the clicker for a new flip: reset counters, derive this flip's golden index, and
  // (for real sessions) prime from the server so a resumed flip continues its count instead
  // of restarting at zero. A null sid = demo → local-only with a random golden. A real sid
  // without the salt preimage = recovered on a device that never placed the flip → clicker off.
  const startTapSession = useCallback((sid: string | null, salt: string | null) => {
    tapSessionRef.current = sid;
    tapRawRef.current = 0;
    tapSentRef.current = 0;
    setTapSessionId(sid);
    setTapSalt(salt);
    setTapRaw(0);
    setTapPrime(0);
    setTapGolden(null);
    if (!sid) {
      setTapGolden(1 + Math.floor(Math.random() * TAP_CAP));
      return;
    }
    if (!salt) return;
    void clientGoldenIndex(sid).then((g) => {
      if (tapSessionRef.current === sid) setTapGolden(g);
    });
    // count=0 is a read: the server replies with the stored count (monotonic max, so this
    // can never lower anything). Failure is fine — the count just starts from zero locally.
    void sendTaps(sid, 0, salt)
      .then((r) => {
        if (tapSessionRef.current !== sid) return;
        tapSentRef.current = r.taps;
        if (r.taps > tapRawRef.current) {
          tapRawRef.current = r.taps;
          setTapRaw(r.taps);
        }
        setTapPrime(r.taps);
      })
      .catch(() => {
        // offline prime is non-critical
      });
  }, []);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Wallets whose server-side active-flip recovery has already run this page session, so
  // dismissing a recovered result (Play Again → idle) doesn't re-trigger the same recovery.
  const apiRecoveredRef = useRef<Set<string>>(new Set());
  // Drafts already chain-checked this page session (keyed addr:saltHash) — a kept draft must
  // not re-run the box probe on every idle transition; a reload re-checks naturally.
  const draftCheckedRef = useRef<Set<string>>(new Set());
  // The currently connected wallet — read inside long-running recovery loops so a wallet
  // switch mid-loop aborts them instead of writing state for the wrong account.
  const liveAddrRef = useRef<string | null>(null);
  useEffect(() => {
    liveAddrRef.current = activeAccount?.address ?? null;
  }, [activeAccount?.address]);
  // Label for the signing-phase spinner ("Awaiting signature" vs "Checking the chain").
  const [signingLabel, setSigningLabel] = useState('Awaiting signature');
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

  // Hydrate the win streak for the connected wallet. localStorage gives an instant optimistic value;
  // the server (computed from the bets table) is authoritative and overrides once it resolves — so
  // the chip stays correct across reloads, a cleared localStorage, and different devices.
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
    let cancelled = false;
    void fetchStreak(addr)
      .then((s) => {
        if (cancelled) return;
        setStreak(s);
        try {
          localStorage.setItem(`fg_streak_${addr}`, String(s));
        } catch {
          // ignore storage failures (private mode)
        }
      })
      .catch(() => {
        // keep the localStorage value on a fetch failure
      });
    return () => {
      cancelled = true;
    };
  }, [activeAccount?.address]);

  // Lifetime FAIR total for the chip — refreshed on connect and shortly after each resolve
  // (the small delay lets the final tap flush land server-side first).
  useEffect(() => {
    const addr = activeAccount?.address;
    if (!addr) {
      setFairTotal(null);
      return;
    }
    let cancelled = false;
    const load = (): void => {
      void fetchFairPoints(addr)
        .then((p) => {
          if (!cancelled) setFairTotal(p.totalPoints);
        })
        .catch(() => {
          // chip is decorative; keep the previous value on a fetch hiccup
        });
    };
    load();
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (phase === 'resolved') timer = setTimeout(load, 1500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeAccount?.address, phase]);

  // Sync taps upstream while the flip seals: a 2.5s batch interval, a final flush when the
  // phase leaves 'pending' (effect cleanup), and a sendBeacon flush when the tab hides/closes.
  // Counts are ABSOLUTE and the server keeps max(), so overlap/replay is harmless.
  useEffect(() => {
    if (phase !== 'pending' || !tapSessionId || !tapSalt) return;
    const flush = (): void => {
      const count = Math.min(tapRawRef.current, TAP_CAP);
      if (count <= tapSentRef.current) return;
      void sendTaps(tapSessionId, count, tapSalt)
        .then((r) => {
          // Mark sent from the server's ACCEPTED count, not what we asked for: the rate
          // ceiling can clamp an early burst, and marking the full count as sent would
          // stop retries and permanently undercount (codex review finding).
          tapSentRef.current = Math.max(tapSentRef.current, r.taps);
        })
        .catch(() => {
          // transient — the next interval (or the beacon) retries with the same absolute count
        });
    };
    const onHide = (): void => {
      if (document.visibilityState !== 'hidden') return;
      const count = Math.min(tapRawRef.current, TAP_CAP);
      if (count > tapSentRef.current) beaconTaps(tapSessionId, count, tapSalt);
    };
    const iv = setInterval(flush, 2500);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(iv);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      flush(); // the phase just changed (resolve/error) — bank whatever is uncommitted
    };
  }, [phase, tapSessionId, tapSalt]);

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
            clearPendingFlip(bettor); // resolved — drop the recovery record
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
          } else if (state.state === 'failed' || state.state === 'beacon_expired') {
            // Terminal without a result: the flip can't be auto-resolved. Stop polling and point
            // the player at the refund instead of spinning forever.
            clearTimers();
            clearPendingFlip(bettor);
            setError({
              message:
                state.state === 'beacon_expired'
                  ? 'This flip aged out before it could be resolved.'
                  : 'This flip could not be auto-resolved.',
              fundsSafe: false,
              hint: 'Your stake is safe on-chain — reclaim it with a refund after the 48-hour window.',
            });
            setPhase('error');
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

  // Resume a flip that is provably committed on-chain (live box) but unknown to this client:
  // find its txn, register it (recordBet is idempotent and adopts sweep-registered rows), and
  // enter the normal pending flow. When the indexer lags, fall back to polling /active until
  // the keeper's orphan sweep registers the flip server-side. Returns false when the flip
  // could not be attached — the caller decides what to tell the player.
  const resumeOnChainFlip = useCallback(
    async (
      addr: string,
      box: OnChainFlipBox,
      draft: { salt?: string; pick?: CoinSide; referrer?: string | null },
    ): Promise<boolean> => {
      const appId = BigInt(process.env['NEXT_PUBLIC_COINFLIP_APP_ID'] ?? '0');
      const pick: CoinSide = draft.pick ?? 'heads';

      let txnId: string | null = null;
      for (let i = 0; i < 2 && !txnId; i++) {
        txnId = await findFlipTxnId(appId, addr, box.commitRound).catch(() => null);
        if (!txnId) await sleep(3000);
      }
      if (liveAddrRef.current !== addr) return false;

      if (txnId) {
        persistPendingFlip(addr, {
          txnId,
          commitRound: box.commitRound.toString(),
          saltHash: box.saltHashHex,
          salt: draft.salt,
          betMicroalgo: box.betMicroalgo.toString(),
          pick,
          referrer: draft.referrer ?? null,
        });
        const { sessionId: sid } = await recordBet({
          walletAddress: addr,
          txnId,
          commitRound: box.commitRound,
          saltHash: hexToBytes(box.saltHashHex),
          betMicroalgo: box.betMicroalgo,
          pick,
          referrerWallet: draft.referrer ?? null,
        });
        if (liveAddrRef.current !== addr) return false;
        setPick(pick);
        setFlipSeed(box.commitRound);
        startTapSession(sid, draft.salt ?? null);
        setPhase('pending');
        startCountdown();
        pollResolution(sid, pick, addr);
        return true;
      }

      // Indexer lag: show the wait while the keeper's orphan sweep (~20s cadence) registers
      // the flip; attach as soon as the server knows it.
      setPick(pick);
      setFlipSeed(box.commitRound);
      setPhase('pending');
      startCountdown();
      for (let i = 0; i < 15; i++) {
        await sleep(5000);
        if (liveAddrRef.current !== addr) return false;
        try {
          const active = await fetchActiveFlip(addr);
          if (active.sessionId && (active.status === 'active' || active.status === 'recent')) {
            startTapSession(active.sessionId, draft.salt ?? null);
            pollResolution(active.sessionId, pick, addr);
            return true;
          }
        } catch {
          // transient — keep waiting for the sweep
        }
      }
      return false;
    },
    [startTapSession, startCountdown, pollResolution],
  );

  // Recover a flip that confirmed on-chain but may not have been registered with the keeper (the
  // API was unreachable when recordBet ran, or the tab closed mid-flight). recordBet is idempotent,
  // so re-registering either creates the session (so the keeper resolves it) or returns the existing
  // one; then resume polling. Runs only while idle so it never interrupts an active flip.
  useEffect(() => {
    const addr = activeAccount?.address;
    if (isDemo || !addr || phase !== 'idle') return;
    let cancelled = false;
    void (async () => {
      const rec = readPendingFlip(addr);
      if (rec) {
        // Fast path: this device still holds the recovery record. Re-register (idempotent) and
        // resume polling.
        try {
          const { sessionId: sid } = await recordBet({
            walletAddress: addr,
            txnId: rec.txnId,
            commitRound: BigInt(rec.commitRound),
            saltHash: hexToBytes(rec.saltHash),
            betMicroalgo: BigInt(rec.betMicroalgo),
            pick: rec.pick,
            referrerWallet: rec.referrer,
          });
          if (cancelled) return;
          clearDraftFlip(addr); // the confirmed record supersedes any draft
          setPick(rec.pick);
          setFlipSeed(BigInt(rec.commitRound));
          startTapSession(sid, rec.salt ?? null);
          setPhase('pending');
          startCountdown();
          pollResolution(sid, rec.pick, addr);
        } catch {
          // API still unreachable — keep the record; a later reload/reconnect retries.
        }
        return;
      }
      // A signature was requested but the submit outcome never came back (tab closed during the
      // wallet hand-off, or the page died with the fetch). The chain is the truth: a live box
      // matching the draft's salt hash means the flip committed — resume it with full fidelity
      // (the draft holds the salt preimage, so taps keep banking). A missed read is NOT proof
      // the flip never landed (a signed txn stays valid ~46 min), so the draft is kept until it
      // expires; only a live MISMATCHED box (a different flip) proves this draft is dead.
      const draft = readDraftFlip(addr);
      if (draft) {
        const DRAFT_TTL_MS = 50 * 60_000; // past the txn validity window — can never land now
        if (Date.now() - draft.createdAt > DRAFT_TTL_MS) {
          clearDraftFlip(addr);
        } else if (!draftCheckedRef.current.has(`${addr}:${draft.saltHash}`)) {
          draftCheckedRef.current.add(`${addr}:${draft.saltHash}`);
          try {
            const appId = BigInt(process.env['NEXT_PUBLIC_COINFLIP_APP_ID'] ?? '0');
            let box = await fetchFlipBox(appId, addr).catch(() => null);
            if (!box && Date.now() - draft.createdAt < 2 * 60_000) {
              // Fresh draft: the txn may still be confirming — give it one more look.
              await sleep(5000);
              if (cancelled) return;
              box = await fetchFlipBox(appId, addr).catch(() => null);
            }
            if (cancelled) return;
            if (box && box.saltHashHex === draft.saltHash) {
              const resumed = await resumeOnChainFlip(addr, box, draft);
              if (resumed) {
                clearDraftFlip(addr);
                return;
              }
            } else if (box) {
              // A different flip owns the box — this draft can never become live.
              clearDraftFlip(addr);
            }
          } catch {
            // chain check is best-effort — fall through to server-side recovery
          }
        }
      }
      // No local record (cleared cache / different device / reload mid-flight). Ask the API
      // whether this wallet has a flip the keeper is tracking — server-side truth, so a flip
      // is never lost from the UI just because localStorage was gone. Once per wallet per page
      // session, so dismissing a recovered result doesn't loop back to it.
      if (apiRecoveredRef.current.has(addr)) return;
      try {
        const active = await fetchActiveFlip(addr);
        if (cancelled) return;
        apiRecoveredRef.current.add(addr);
        if (active.status === 'none' || !active.sessionId) return;
        const recoveredPick: CoinSide = active.playerPick ?? 'heads';
        if (active.status === 'active') {
          setPick(recoveredPick);
          setFlipSeed(active.commitRound ?? 0n);
          // No salt preimage on this path (the flip was placed elsewhere — different device
          // or cleared storage): the clicker stays off so it never shows points that can't bank.
          startTapSession(active.sessionId, null);
          setPhase('pending');
          startCountdown();
          pollResolution(active.sessionId, recoveredPick, addr);
        } else if (active.status === 'recent' && active.outcome !== 'pending') {
          // It resolved while the player was away — show the result (without auto-popping the
          // share modal, which would be jarring on a fresh return).
          setResult({
            outcome: active.outcome,
            playerPick: recoveredPick,
            walletAddress: addr,
            netPayoutMicroalgo: active.netPayoutMicroalgo,
            proofCardUrl: active.proofCardUrl,
            txnId: active.txnId,
          });
          setPhase('resolved');
        }
      } catch {
        // Recovery is best-effort; on any API hiccup stay idle.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeAccount?.address,
    isDemo,
    phase,
    startCountdown,
    pollResolution,
    startTapSession,
    resumeOnChainFlip,
  ]);

  const handleFlip = useCallback(async () => {
    if (!activeAccount) return;
    setError(null);
    setSigningLabel('Awaiting signature');
    setPhase('signing');
    primeAudio();
    sfx.toss();
    window.setTimeout(() => sfx.clink(), 340);

    // Tracks whether the on-chain flip confirmed: once true, any later failure is a tracking
    // failure, NOT a funds failure -- the error copy must never claim the stake was not wagered.
    let fundsCommitted = false;
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
      const referrerWallet = referrer && referrer !== activeAccount.address ? referrer : null;

      // Draft record BEFORE the wallet hand-off: if the page's network dies mid-submit
      // (iOS Safari app-switch) or the tab closes, the chain check can later identify and
      // resume this exact flip by its salt hash — and keep its taps bankable via the salt.
      persistDraftFlip(activeAccount.address, {
        salt: bytesToHex(salt),
        saltHash: bytesToHex(saltHash),
        betMicroalgo: betMicroalgo.toString(),
        pick,
        referrer: referrerWallet,
        createdAt: Date.now(),
      });
      const { commitRound, txnId } = await sendFlip({
        network: NETWORK,
        coinflipAppId,
        sender: activeAccount.address,
        signer: transactionSigner,
        betMicroalgo,
        boxMbr: BOX_MBR,
        saltHash,
        referrer: referrerWallet,
      });
      fundsCommitted = true;

      // The stake is escrowed on-chain now. Persist a recovery record so a lost/failed recordBet
      // (or a reload) can re-register the flip with the keeper -- without a session the keeper never
      // resolves it. recordBet is idempotent, so re-registering is safe.
      persistPendingFlip(activeAccount.address, {
        txnId,
        commitRound: commitRound.toString(),
        saltHash: bytesToHex(saltHash),
        salt: bytesToHex(salt), // tap-write proof — lets a reload keep banking taps
        betMicroalgo: betMicroalgo.toString(),
        pick,
        referrer: referrerWallet,
      });
      clearDraftFlip(activeAccount.address); // upgraded to the confirmed record above

      // Register the pending session so the keeper resolves it and the UI can poll.
      const { sessionId: sid } = await recordBet({
        walletAddress: activeAccount.address,
        txnId,
        commitRound,
        saltHash,
        betMicroalgo,
        pick,
        referrerWallet,
      });

      setFlipSeed(commitRound);
      startTapSession(sid, bytesToHex(salt));
      setPhase('pending');
      startCountdown();
      pollResolution(sid, pick, activeAccount.address);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (fundsCommitted) {
        // The flip IS confirmed on-chain; only registering it with the tracker failed. Never claim
        // the funds are untouched. The recovery record lets a refresh resume it.
        setError({
          message: 'Flip confirmed on-chain — could not reach the live tracker.',
          fundsSafe: false,
          hint: 'Refresh in ~30s to see the result. Your stake is safe on-chain; if it never resolves, a refund is available after 48h.',
        });
      } else if (isIndeterminateNetworkError(message)) {
        // The network path died mid-submit — the txn's fate is UNKNOWN (iOS Safari kills the
        // page's fetches during the wallet app-switch; the group often confirms anyway). Ask the
        // chain before making any claim about the player's funds. Real incident 2026-06-11: a
        // confirmed 20-ALGO flip was shown "your funds were not wagered".
        const addr = activeAccount.address;
        const draft = readDraftFlip(addr);
        setSigningLabel('Checking the chain');
        const appId = BigInt(process.env['NEXT_PUBLIC_COINFLIP_APP_ID'] ?? '0');
        let box = await fetchFlipBox(appId, addr).catch(() => null);
        if (!box) {
          // The submit may have gone out just before the failure — give confirmation a beat.
          await sleep(8000);
          box = await fetchFlipBox(appId, addr).catch(() => null);
        }
        if (box && draft && box.saltHashHex === draft.saltHash) {
          const resumed = await resumeOnChainFlip(addr, box, draft).catch(() => false);
          if (resumed) {
            clearDraftFlip(addr);
            return;
          }
          setError({
            message: 'Your flip IS on-chain — the live tracker is unreachable.',
            fundsSafe: false,
            hint: 'Refresh in a minute to see the result. If it never resolves, a refund is available after 48h.',
          });
        } else if (box) {
          // A live box that does not match this attempt: an earlier flip is still active.
          setError({
            message: 'A previous flip is still active on-chain.',
            fundsSafe: false,
            hint: 'Refresh to resume it; refund is available after 48h.',
          });
        } else {
          // No box found — but one missed read is NOT proof the group was never submitted
          // (the signed txn stays valid for ~46 min and a wallet can broadcast late). Keep
          // the draft so a reload re-checks the chain, and never claim "nothing was wagered".
          setError({
            message: 'Connection dropped while submitting.',
            fundsSafe: false,
            hint: 'No wager found on-chain yet. If your wallet broadcast it late, it will be picked up automatically — refresh in a minute before re-flipping.',
          });
        }
      } else if (
        /another request|request pending|already.*in progress|in progress|pending request/i.test(
          message,
        )
      ) {
        // Wallet-level, not chain-level: the connected wallet still holds an unfinished signing
        // request (e.g. a previous prompt left open, or a reload mid-sign). Nothing was wagered.
        setError({
          message: 'Your wallet has a request still in progress.',
          fundsSafe: true,
          hint: 'Open your wallet (Pera/Defly) to finish or dismiss the previous prompt, then flip again. No funds were wagered.',
        });
      } else if (activeAccount && readPendingFlip(activeAccount.address)) {
        // A prior flip is still escrowed on-chain and unresolved (e.g. the contract rejected this
        // attempt because that flip is still active) -- do not claim the funds are untouched.
        setError({
          message,
          fundsSafe: false,
          hint: 'A previous flip is still on-chain and unresolved. Refresh to resume it; refund is available after 48h.',
        });
      } else {
        setError({ message, fundsSafe: true });
      }
      setPhase('error');
    }
  }, [
    activeAccount,
    betAlgo,
    pick,
    transactionSigner,
    referrer,
    startCountdown,
    pollResolution,
    startTapSession,
    resumeOnChainFlip,
  ]);

  // Wallet-free walkthrough: runs the full visual flow (sign → VRF wait → reveal) with a
  // forced outcome and a shortened wait, so the experience can be shown without a chain hit.
  const handleDemoFlip = useCallback(() => {
    if (!demoOutcome) return;
    setError(null);
    setFlipSeed(BigInt(Math.floor(Math.random() * 1_000_000_000)));
    setPhase('signing');
    primeAudio();
    sfx.toss();
    window.setTimeout(() => sfx.clink(), 340);
    const pendingMs = demoPendingMs();
    setDemoWaitMs(pendingMs);
    pollRef.current = setTimeout(() => {
      startTapSession(null, null); // demo clicker: local-only, random golden, no server writes
      setPhase('pending');
      const start = Date.now();
      setCountdown(pendingMs);
      countdownRef.current = setInterval(() => {
        const remaining = Math.max(0, pendingMs - (Date.now() - start));
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
      }, pendingMs);
    }, 700);
  }, [demoOutcome, betAlgo, pick, clearTimers, startTapSession]);

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
  const countdownMax = isDemo ? demoWaitMs : VRF_MS;

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
  // The side the coin actually LANDED on — the player's pick on a win, the opposite on a loss.
  // The result label uses this (not the raw pick) so the words match the face the coin shows:
  // "Heads — You Lost" + a heads coin, never "Tails — You Lost" + a heads coin.
  const landedSide: CoinSide = result
    ? result.outcome === 'win'
      ? result.playerPick
      : result.playerPick === 'heads'
        ? 'tails'
        : 'heads'
    : 'heads';

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
    if (!QUEUE_ENABLED || phase !== 'resolved' || !queued) return;
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
    if (!QUEUE_ENABLED || !armed || phase !== 'idle') return;
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
        {/* Lifetime FAIR points — quiet chip; links to the FAIR standings. */}
        {isConnected && fairTotal !== null && fairTotal > 0 && (
          <a
            href="/leaderboard?board=fair"
            className="mt-1.5 inline-flex items-baseline gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] transition-opacity hover:opacity-75"
            style={{ color: 'var(--color-text-muted)' }}
            title="FAIR points — earned by playing; taps during the seal wait add a little"
          >
            <span aria-hidden style={{ color: 'var(--color-primary)' }}>
              ◈
            </span>
            <span className="tabular-nums" style={{ color: 'var(--color-primary)' }}>
              {fairTotal.toLocaleString('en-US')}
            </span>
            fair
          </a>
        )}
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
          · earns 1% of your stake
        </div>
      )}

      {/* Idle hero — the coin is alive the moment you land on the page */}
      {(phase === 'idle' || phase === 'error') && (
        <div
          className="flex flex-col items-center justify-center gap-2"
          style={{ minHeight: '8rem' }}
        >
          <Coin3DWrapper variant={coinVariant} phase="idle" outcome={null} size={150} />
        </div>
      )}

      {/* Side picker + bet — shown only while idle/error; hidden during the wait + reveal so the
          pending phase (coin + oracle + queue) stays compact and the oracle is above the fold. */}
      {(phase === 'idle' || phase === 'error') && (
        <>
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
                className="fg-btn flex flex-1 items-center justify-center gap-2.5 border py-2.5 text-sm font-semibold uppercase tracking-widest"
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
                {/* The actual coin face so the choice is unmistakable: heads = the coop head,
                    tails = the Algorand mark. */}
                <span
                  aria-hidden
                  className="h-7 w-7 shrink-0 rounded-full bg-cover bg-center transition-all"
                  style={{
                    backgroundImage: `url(${side === 'heads' ? '/coin/coop.webp' : '/coin/algorand.webp'})`,
                    filter: pick === side ? 'none' : 'grayscale(0.55)',
                    opacity: pick === side ? 1 : 0.65,
                    boxShadow:
                      pick === side
                        ? '0 0 9px oklch(0.78 0.18 65 / 0.45)'
                        : 'inset 0 0 0 1px var(--color-border)',
                  }}
                />
                {side === 'heads' ? 'Heads' : 'Tails'}
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
            {/* Quick-pick presets — only those within the contract's enforced min/max bet. */}
            <div className="flex flex-wrap gap-2">
              {[0.1, 1, 5, 10, 20]
                .filter((v) => v >= MIN_BET_ALGO && v <= MAX_BET_ALGO)
                .map((amt) => {
                  const active = parseFloat(betAlgo) === amt;
                  return (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        setBetAlgo(String(amt));
                        if (phase === 'error') {
                          setPhase('idle');
                          setError(null);
                        }
                      }}
                      disabled={!canFlip}
                      className="border px-3 py-1 font-mono text-xs tabular-nums transition-colors disabled:opacity-40"
                      style={{
                        borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                        color: active ? 'var(--color-primary)' : 'var(--color-text-dim)',
                        background: active ? 'var(--color-primary-dim)' : 'transparent',
                      }}
                    >
                      {amt}
                    </button>
                  );
                })}
            </div>
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
        </>
      )}

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
      {phase === 'signing' && <AsciiSpinner label={signingLabel} />}

      {/* VRF pending — the coin is in the air, consensus is the referee. Kept deliberately quiet:
          one streak chip above the coin, one status headline, the block bar, one rotating oracle
          line. (The block-step sub-copy and the queue control were removed to cut visual noise.) */}
      {phase === 'pending' && (
        <div className="flex flex-col items-center gap-3 py-1">
          {streak >= 3 && (
            <div
              className="font-mono text-[11px] font-bold uppercase tracking-[0.3em]"
              style={{ color: 'var(--color-primary)' }}
            >
              ◇ streak at risk · {streak}
            </div>
          )}
          <TapCoinField
            active={isDemo || Boolean(tapSalt)}
            goldenIndex={tapGolden}
            primeRaw={tapPrime}
            onCount={handleTapCount}
            resetKey={`${tapSessionId ?? 'demo'}:${flipSeed}`}
          >
            <div className="flex items-center justify-center" style={{ minHeight: '11rem' }}>
              <Coin3DWrapper variant={coinVariant} phase="pending" outcome={null} size={190} />
            </div>
          </TapCoinField>
          <div
            className="text-center text-sm font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-vrf)' }}
          >
            {waitCopy.head}
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

          {/* Queue the next flip — staged for a later release (QUEUE_ENABLED), hidden for now. */}
          {QUEUE_ENABLED &&
            (queued ? (
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
            ))}
        </div>
      )}

      {/* Result */}
      {phase === 'resolved' && result && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div className="relative flex items-center justify-center" style={{ minHeight: '11rem' }}>
            {isWin && <div className="shockwave" />}
            {isLoss && <div className="shockwave is-loss" />}
            <Coin3DWrapper
              variant={coinVariant}
              phase="resolved"
              // The coin lands on the side that actually came up: your pick on a win, the
              // opposite on a loss.
              outcome={
                result.outcome === 'win'
                  ? result.playerPick
                  : result.playerPick === 'heads'
                    ? 'tails'
                    : 'heads'
              }
              size={190}
            />
          </div>
          {/* Brief radial flash on a win; red screen-edge vignette on a loss. */}
          {isWin && <div className="win-flash" />}
          {isLoss && <div className="loss-vignette" />}

          {/* Hairline outcome-tinted rule: a receipt-edge anchor between the coin and the verdict. */}
          <div
            aria-hidden
            style={{
              width: '3rem',
              borderTop: '1px solid',
              borderColor: isWin ? 'var(--color-win)' : 'var(--color-lose)',
              opacity: 0.4,
            }}
          />

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
            className="flex flex-col items-center gap-1.5"
          >
            {/* On a win the money is the hero — payout first and largest, the verdict label
                drops to a quiet subhead. On a loss the verdict IS the story, so it leads. */}
            {isWin && result.netPayoutMicroalgo !== null && (
              <div
                className="payout-slam phosphor-win font-mono text-4xl font-black tabular-nums"
                style={{ color: 'var(--color-win)' }}
              >
                +{formatAlgo(displayPayout)} ALGO
              </div>
            )}
            <ScrambleText
              className={
                isWin
                  ? 'glitch-label text-base font-semibold uppercase tracking-[0.3em]'
                  : 'glitch-label text-2xl font-bold uppercase tracking-widest'
              }
              style={{
                color: isWin
                  ? 'var(--color-win)'
                  : isLoss
                    ? 'var(--color-lose)'
                    : 'var(--color-primary)',
                opacity: isWin ? 0.7 : 1,
              }}
              text={
                isWin
                  ? `${landedSide === 'heads' ? 'Heads' : 'Tails'} — You Won`
                  : isLoss
                    ? `${landedSide === 'heads' ? 'Heads' : 'Tails'} — You Lost`
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
            {/* FAIR earned this flip: 100 for playing + banked taps (golden bonus included). */}
            {(isWin || isLoss) && (
              <div
                className="mt-1 font-mono text-[11px] uppercase tracking-[0.25em] tabular-nums"
                style={{ color: 'var(--color-primary)', opacity: 0.9 }}
              >
                ◈ +{FLIP_POINTS + bankedTapPoints(tapRaw, tapGolden)} fair
                {tapRaw > 0 && (
                  <span style={{ color: 'var(--color-text-muted)' }}>
                    {' '}
                    · {FLIP_POINTS} flip + {bankedTapPoints(tapRaw, tapGolden)} taps
                  </span>
                )}
              </div>
            )}
          </motion.div>

          <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
            {result.proofCardUrl && (
              <button
                onClick={() => setShowShareModal(true)}
                className="fg-btn w-full whitespace-nowrap border px-4 py-2.5 text-center text-sm font-semibold uppercase tracking-wide hover:opacity-80"
                style={{
                  borderColor: 'var(--color-vrf)',
                  color: 'var(--color-vrf)',
                  background: 'var(--color-vrf-dim)',
                }}
              >
                [ Share Proof ]
              </button>
            )}
            <button
              onClick={reset}
              className="fg-btn w-full whitespace-nowrap border px-4 py-2.5 text-center text-sm font-semibold uppercase tracking-wide hover:opacity-80"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
            >
              {isLoss ? '[ Accept // Retry ]' : '[ Play Again ]'}
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
          {error.message}
          <div className="mt-1 font-mono text-xs" style={{ opacity: 0.55 }}>
            {error.fundsSafe
              ? '// your funds were not wagered. the chain is fine.'
              : `// ${error.hint ?? 'your stake is safe on-chain.'}`}
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
  // Link to THIS deployment's origin (so testnet/staging/local shares don't point at prod).
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://app.fairground.quest';
  // Canonical proof permalink: /proof/{txnId} carries the card as the tweet's large-image preview
  // AND, when opened, frames the result and routes a recruit into a flip attributed to this wallet
  // (the page reads the owner wallet as the referrer). A raw PNG link would be a dead end; the
  // old `/?proof=` query form still works for back-compat but the permalink is the share target.
  const shareLink = txnId
    ? `${origin}/proof/${txnId}`
    : walletAddress
      ? `${origin}/?ref=${walletAddress}`
      : origin;
  const twitterIntent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareLink)}&via=FairgroundHQ`;

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
