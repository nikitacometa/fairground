'use client';

import { useWallet } from '@txnlab/use-wallet-react';
import { useState } from 'react';

function truncate(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function WalletButton() {
  const { activeAccount, wallets, isReady } = useWallet();
  const [open, setOpen] = useState(false);

  if (!isReady) {
    return (
      <button
        disabled
        className="rounded border px-4 py-2 text-sm opacity-40"
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
          activeWallet?.disconnect();
        }}
        className="rounded border px-4 py-2 text-sm font-mono transition-opacity hover:opacity-70"
        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-dim)' }}
        title="Click to disconnect"
      >
        {truncate(activeAccount.address)}
      </button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded border px-4 py-2 text-sm font-semibold tracking-wide transition-opacity hover:opacity-80"
        style={{
          borderColor: 'var(--color-primary)',
          color: 'var(--color-primary)',
          background: 'var(--color-primary-dim)',
        }}
      >
        Connect Wallet
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-2 flex w-44 flex-col gap-1 rounded border p-2 shadow-lg"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          {wallets.map((wallet) => (
            <button
              key={wallet.id}
              onClick={async () => {
                await wallet.connect();
                setOpen(false);
              }}
              className="rounded px-3 py-2 text-left text-sm transition-colors hover:bg-white/5"
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
