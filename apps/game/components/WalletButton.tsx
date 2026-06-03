'use client';

import { useWallet } from '@txnlab/use-wallet-react';
import { WalletName } from '@fairground/nfd/react';
import { useEffect, useState } from 'react';

export function WalletButton() {
  const { activeAccount, wallets, isReady } = useWallet();
  const [open, setOpen] = useState(false);
  // Hydration guard: Pera/Defly resume their session synchronously from localStorage, so
  // the client's first paint has isReady=true while the server rendered isReady=false.
  // Render the SSR-safe skeleton until mounted to avoid a #418 text-content mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || !isReady) {
    return (
      <button
        disabled
        className="border px-4 py-2 text-sm opacity-40"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-muted)' }}
      >
        Loading…
      </button>
    );
  }

  if (activeAccount) {
    return (
      <button
        onClick={() => {
          const activeWallet = wallets.find((w) => w.isActive);
          void activeWallet?.disconnect();
        }}
        className="border px-4 py-2 text-sm font-mono transition-opacity hover:opacity-70"
        style={{ borderColor: 'var(--color-border)' }}
        title={`${activeAccount.address}\nClick to disconnect`}
      >
        <WalletName address={activeAccount.address} />
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="border px-4 py-2 text-sm font-semibold tracking-wide transition-opacity hover:opacity-80"
        style={{
          borderColor: 'var(--color-primary)',
          color: 'var(--color-primary)',
          background: 'var(--color-primary-dim)',
        }}
      >
        [ Connect Wallet ]
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 flex w-44 flex-col gap-1 border p-2 shadow-lg"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          {wallets.map((wallet) => (
            <button
              key={wallet.id}
              onClick={async () => {
                await wallet.connect();
                setOpen(false);
              }}
              className="px-3 py-2 text-left text-sm transition-colors hover:bg-white/5"
              style={{ color: 'var(--color-text)' }}
            >
              {wallet.metadata.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
