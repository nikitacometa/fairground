'use client';

/**
 * Coin3DWrapper — lazy-loads the WebGL coin as a separate chunk (ssr:false; the three.js bundle
 * never touches the initial page load and is fetched only when the 3D coin is enabled). While the
 * chunk loads it shows the ASCII CoinTossScene, which is also the permanent fallback when 3D is off
 * or unsupported. See useCoin3DEnabled in CoinflipGame for the toggle.
 */

import dynamic from 'next/dynamic';
import { Component, Suspense, type ReactNode } from 'react';
import { CoinTossScene } from './CoinTossScene';
import type { Coin3DProps } from './Coin3D';

const Coin3D = dynamic(() => import('./Coin3D'), {
  ssr: false,
  loading: () => <CoinTossScene variant={0} />,
});

/**
 * If the WebGL coin throws at runtime — a coin texture that failed to load (a network blip, a
 * blocked/rate-limited asset, a slow connection), a lost WebGL context, an unsupported GPU — fall
 * back to the dependency-free ASCII coin. Suspense only handles the pending state; a thrown loader
 * error would otherwise bubble to the app error boundary and white-screen the WHOLE page. The coin
 * is decorative — it must never be able to take the game down.
 */
class CoinErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    // Observable but not alarming — the fallback already kept the page alive.
    console.warn('[coin] 3D coin failed, using ASCII fallback:', error);
  }

  render(): ReactNode {
    if (this.state.failed) return <CoinTossScene variant={0} />;
    return this.props.children;
  }
}

export function Coin3DWrapper(props: Coin3DProps) {
  return (
    <CoinErrorBoundary>
      <Suspense fallback={<CoinTossScene variant={0} />}>
        <Coin3D {...props} />
      </Suspense>
    </CoinErrorBoundary>
  );
}
