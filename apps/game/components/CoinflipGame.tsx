'use client';

/**
 * CoinflipGame — main game UI for the Fairground coinflip dApp.
 *
 * Flow:
 *   1. Player picks heads/tails and enters a bet amount.
 *   2. On "Flip", we build the bet group via @fairground/sdk, sign via
 *      use-wallet, and broadcast. The API records the pending session.
 *   3. A ~22s VRF countdown plays (commit round = current + 8 at 2.8s/block).
 *   4. We poll the API for resolution.
 *   5. Win/lose is revealed; a proof-card share modal opens.
 *
 * TODO: once `pnpm contracts:generate` has run, replace the TODO markers
 * with the real generated client method names from CoinflipContractClient.
 */

import { useWallet } from '@txnlab/use-wallet-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBetState, submitBet } from '../lib/api';
import { useRelayerWake } from './useRelayerWake';
import type { BetOutcome } from '@fairground/types';

// BOX_MBR from contract: 49,300 microALGO (FlipState 80 bytes: vrf_round8 + bet8 + salt_hash32 + referrer32)
const BOX_MBR = 49_300n;
// Default min bet: 500,000 microALGO = 0.5 ALGO
const DEFAULT_MIN_BET = 500_000n;
const DEFAULT_MAX_BET = 500_000n;

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

export function CoinflipGame() {
  const { activeAccount, signTransactions } = useWallet();
  const [pick, setPick] = useState<CoinSide>('heads');
  const [betAlgo, setBetAlgo] = useState('0.5');
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(VRF_MS);
  const [result, setResult] = useState<ResolvedResult | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);

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
      const betMicroalgo = BigInt(Math.round(parseFloat(betAlgo) * 1_000_000));

      if (betMicroalgo < DEFAULT_MIN_BET) {
        throw new Error(`Minimum bet is ${Number(DEFAULT_MIN_BET) / 1e6} ALGO`);
      }
      if (betMicroalgo > DEFAULT_MAX_BET) {
        throw new Error(`Maximum bet is ${Number(DEFAULT_MAX_BET) / 1e6} ALGO`);
      }

      // Generate a 32-byte random player salt and its hash.
      // The salt preimage is kept client-side — the contract only receives saltHash.
      // On resolve, sha256(beaconOutput || saltHash)[0] % 2 determines the outcome.
      const salt = crypto.getRandomValues(new Uint8Array(32));
      const saltHashBuffer = await crypto.subtle.digest('SHA-256', salt);
      const saltHash = new Uint8Array(saltHashBuffer);

      const coinflipAppId = BigInt(process.env['NEXT_PUBLIC_COINFLIP_APP_ID'] ?? '0');

      /**
       * TODO: replace this block with the generated client once `pnpm contracts:generate` runs.
       *
       * Expected API shape (from contract ABI):
       *   import { CoinflipContractClient } from '@fairground/sdk';
       *
       *   const txnGroup = await CoinflipContractClient.buildFlipGroup({
       *     // TODO: confirm exact method name — likely `buildFlipGroup` or `buildBetGroup`
       *     sender: activeAccount.address,
       *     betMicroalgo,        // microALGO (bigint), exclusive of BOX_MBR
       *     saltHash,            // Uint8Array(32)
       *     referrer: null,      // zero address = no referral
       *     coinflipAppId,
       *   });
       *   // txnGroup is Uint8Array[] of encoded (unsigned) transactions
       *
       * For now we call the API submission endpoint directly with the raw params
       * and let the API build the txns server-side (temporary scaffolding).
       */

      // Total payment = bet + BOX_MBR (contract requires both in the payment txn)
      const totalPayment = betMicroalgo + BOX_MBR;

      // TODO: remove server-side txn building once client is generated.
      // Call the submission helper which returns encoded unsigned txns.
      const { encodedTxns, sessionId: sid } = await submitBet({
        walletAddress: activeAccount.address,
        betMicroalgo,
        totalPayment,
        saltHash,
        coinflipAppId,
        pick,
      });

      // Sign the group via the connected wallet
      const signedTxns = await signTransactions(encodedTxns);

      // Broadcast
      const apiBase = process.env['NEXT_PUBLIC_API_URL'] ?? '';
      const broadcastRes = await fetch(`${apiBase}/games/coinflip/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sid,
          // Encode to base64 without Buffer (browser-safe: btoa + String.fromCharCode)
          signedTxns: signedTxns.map((t) => {
            if (!t) throw new Error('transaction was not signed');
            return btoa(String.fromCharCode(...t));
          }),
        }),
      });

      if (!broadcastRes.ok) {
        const body = (await broadcastRes.json()) as { error?: string };
        throw new Error(body.error ?? 'Broadcast failed');
      }

      setSessionId(sid);
      setPhase('pending');
      startCountdown();
      pollResolution(sid, pick);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [activeAccount, betAlgo, pick, signTransactions, startCountdown, pollResolution]);

  const reset = useCallback(() => {
    clearTimers();
    setPhase('idle');
    setError(null);
    setSessionId(null);
    setResult(null);
    setShowShareModal(false);
    setCountdown(VRF_MS);
  }, [clearTimers]);

  const isConnected = Boolean(activeAccount);
  const canFlip = isConnected && phase === 'idle';
  const countdownSec = (countdown / 1000).toFixed(1);

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
            min="0.5"
            max="0.5"
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
          onClick={handleFlip}
          disabled={!canFlip}
          className="rounded border py-4 text-base font-bold uppercase tracking-widest transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            borderColor: 'var(--color-primary)',
            background: 'var(--color-primary-dim)',
            color: 'var(--color-primary)',
          }}
        >
          {!isConnected ? 'Connect wallet to play' : 'Flip'}
        </button>
      ) : null}

      {/* Signing state */}
      {phase === 'signing' && (
        <div className="py-4 text-center text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Approve in your wallet…
        </div>
      )}

      {/* VRF pending countdown */}
      {phase === 'pending' && (
        <div className="flex flex-col items-center gap-3 py-4">
          <CoinSpinner />
          <div className="text-center">
            <div
              className="text-4xl font-bold tabular-nums"
              style={{ color: 'var(--color-vrf)', fontVariantNumeric: 'tabular-nums' }}
            >
              {countdownSec}s
            </div>
            <div
              className="mt-1 text-xs uppercase tracking-widest"
              style={{ color: 'var(--color-text-muted)' }}
            >
              VRF beacon settling — round {sessionId ? '…' : ''}
            </div>
          </div>
          <div
            className="h-1 w-full rounded-full overflow-hidden"
            style={{ background: 'var(--color-border)' }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${100 - (countdown / VRF_MS) * 100}%`,
                background: 'var(--color-vrf)',
              }}
            />
          </div>
        </div>
      )}

      {/* Result */}
      {phase === 'resolved' && result && (
        <div className="flex flex-col items-center gap-4 py-4">
          <div
            className="text-6xl"
            style={{
              color:
                result.outcome === 'win'
                  ? 'var(--color-win)'
                  : result.outcome === 'loss'
                    ? 'var(--color-lose)'
                    : 'var(--color-primary)',
            }}
          >
            {result.outcome === 'win'
              ? result.playerPick === 'heads'
                ? '⬤'
                : '○'
              : result.outcome === 'loss'
                ? result.playerPick === 'heads'
                  ? '⬤'
                  : '○'
                : '★'}
          </div>
          <div
            className="text-2xl font-bold uppercase tracking-widest"
            style={{
              color:
                result.outcome === 'win'
                  ? 'var(--color-win)'
                  : result.outcome === 'loss'
                    ? 'var(--color-lose)'
                    : 'var(--color-primary)',
            }}
          >
            {result.outcome === 'win'
              ? `${result.playerPick === 'heads' ? 'Heads' : 'Tails'} — You Won`
              : result.outcome === 'loss'
                ? `${result.playerPick === 'heads' ? 'Heads' : 'Tails'} — You Lost`
                : result.outcome === 'refunded'
                  ? 'Refunded'
                  : result.outcome}
          </div>
          {result.netPayoutMicroalgo !== null && result.outcome === 'win' && (
            <div className="text-sm" style={{ color: 'var(--color-text-dim)' }}>
              +{(Number(result.netPayoutMicroalgo) / 1e6).toFixed(4)} ALGO
            </div>
          )}

          <div className="flex gap-3">
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

function CoinSpinner() {
  return (
    <div
      className="h-16 w-16 rounded-full border-4 border-t-transparent animate-spin"
      style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
      aria-label="VRF beacon settling"
    />
  );
}

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
