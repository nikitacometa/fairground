import type { Metadata } from 'next';
import { PLATFORM_VERSION } from '@fairground/types';
import { WalletButton } from '../../../components/WalletButton';
import { PotBar } from '../../../components/PotBar';

// Stable, shareable permalink for a single resolved flip: app.fairground.quest/proof/{txnId}.
// This is the canonical URL the share-on-X button points at — it carries the proof-card PNG as the
// Twitter large-image preview (so the result shows in-feed without a click) AND, when opened, lands
// a recruit on a page that frames the result and routes them into a referral-attributed flip.

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'https://api.fairground.quest';

interface ProofMeta {
  txnId: string;
  outcome: 'win' | 'loss';
  playerPick: 'heads' | 'tails' | null;
  multiplier: number;
  netPayoutMicroalgo: string;
  vrfRound: string;
  walletAddress: string;
  walletPrefix: string;
  walletNfd: string | null;
  resolvedAt: string;
}

// microALGO (numeric string) -> "12.34" ALGO. bigint math; never Number on amounts.
function formatAlgo(micro: string): string {
  const m = BigInt(micro);
  const whole = m / 1_000_000n;
  const frac = (m % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${whole.toString()}.${frac}`;
}

async function fetchProofMeta(txnId: string): Promise<ProofMeta | null> {
  try {
    const res = await fetch(`${API_URL}/proof/${encodeURIComponent(txnId)}/meta`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; data?: ProofMeta };
    if (!json.ok || !json.data) return null;
    return json.data;
  } catch {
    // Crawler/visitor still gets a generic-but-valid page; never 500 a share preview.
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ txnId: string }>;
}): Promise<Metadata> {
  const { txnId } = await params;
  const image = `${API_URL}/proof/${encodeURIComponent(txnId)}`;
  const meta = await fetchProofMeta(txnId);

  const title =
    meta?.outcome === 'win'
      ? `Won ${formatAlgo(meta.netPayoutMicroalgo)} ALGO — provably fair on Algorand`
      : 'Provably fair coinflip — verified on-chain';
  const description = meta
    ? `VRF beacon round ${meta.vrfRound} · resolve txn ${txnId.slice(0, 10)}… · derive the outcome yourself.`
    : 'VRF-backed coinflip on Algorand. Every outcome verifiable on-chain.';

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      url: `https://app.fairground.quest/proof/${txnId}`,
      images: [{ url: image, width: 1600, height: 900, alt: 'Fairground VRF proof card' }],
    },
    twitter: {
      card: 'summary_large_image',
      site: '@FairgroundHQ',
      title,
      description,
      images: [image],
    },
  };
}

export default async function ProofPermalinkPage({
  params,
}: {
  params: Promise<{ txnId: string }>;
}) {
  const { txnId } = await params;
  const meta = await fetchProofMeta(txnId);
  const image = `${API_URL}/proof/${encodeURIComponent(txnId)}`;
  const playHref = meta?.walletAddress ? `/?ref=${meta.walletAddress}` : '/';

  const won = meta?.outcome === 'win';
  const pickLabel = meta?.playerPick ? meta.playerPick.toUpperCase() : null;
  const headline = !meta
    ? 'Proof not available yet'
    : won
      ? `${pickLabel ? `${pickLabel} · ` : ''}WON`
      : `${pickLabel ? `${pickLabel} · ` : ''}LOST`;
  const headlineColor = !meta
    ? 'var(--color-text-dim)'
    : won
      ? 'var(--color-win)'
      : 'var(--color-lose)';

  return (
    <>
      <div className="bg-layer" aria-hidden />
      <main className="relative z-10 flex min-h-dvh flex-col items-center justify-start gap-6 px-4 py-6">
        <header className="flex w-full max-w-2xl items-center justify-between">
          <a
            href="https://fairground.quest"
            className="text-lg font-bold tracking-[0.3em] uppercase transition-opacity hover:opacity-80"
            style={{ color: 'var(--color-primary)' }}
          >
            Fairground
          </a>
          <WalletButton />
        </header>

        <PotBar />

        <section className="flex w-full max-w-2xl flex-col gap-5">
          <div className="flex items-baseline justify-between">
            <span
              className="text-sm font-bold uppercase tracking-[0.3em]"
              style={{ color: headlineColor }}
            >
              {headline}
            </span>
            {meta && won && (
              <span
                className="text-2xl font-bold tabular-nums"
                style={{ color: 'var(--color-win)', letterSpacing: '-0.02em' }}
              >
                +{formatAlgo(meta.netPayoutMicroalgo)} ALGO
              </span>
            )}
          </div>

          {meta ? (
            <img
              src={image}
              alt="Fairground VRF proof card"
              width={1600}
              height={900}
              className="w-full border"
              style={{ borderColor: 'var(--color-border)' }}
            />
          ) : (
            <div
              className="flex flex-col items-center gap-2 border px-6 py-16 text-center"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <p className="text-sm" style={{ color: 'var(--color-text-dim)' }}>
                This proof isn’t ready yet — the flip may still be resolving, or the link is wrong.
              </p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                txn {txnId.slice(0, 12)}…
              </p>
            </div>
          )}

          <a
            href={playHref}
            className="fg-btn fg-conic block border py-4 text-center text-sm font-bold uppercase tracking-[0.25em] transition-opacity hover:opacity-80"
            style={{
              borderColor: 'var(--color-primary)',
              color: 'var(--color-primary)',
              background: 'var(--color-primary-dim)',
            }}
          >
            [ Flip your own coin _ ]
          </a>

          {meta && (
            <div
              className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[11px] uppercase tracking-[0.2em]"
              style={{ color: 'var(--color-text-dim)' }}
            >
              <span>VRF round {meta.vrfRound}</span>
              <a
                href={`https://allo.info/tx/${txnId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-vrf)' }}
              >
                Verify on-chain →
              </a>
            </div>
          )}
        </section>

        <footer className="mt-2 flex w-full max-w-2xl flex-col items-center gap-3 text-center">
          <p
            className="text-[10px] uppercase leading-relaxed tracking-[0.15em]"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Provably fair on Algorand · every outcome verifiable on-chain · v{PLATFORM_VERSION}
          </p>
        </footer>
      </main>
    </>
  );
}
