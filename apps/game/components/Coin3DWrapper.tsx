'use client';

/**
 * Coin3DWrapper — lazy-loads the WebGL coin as a separate chunk (ssr:false; the three.js bundle
 * never touches the initial page load and is fetched only when the 3D coin is enabled). While the
 * chunk loads it shows the ASCII CoinTossScene, which is also the permanent fallback when 3D is off
 * or unsupported. See useCoin3DEnabled in CoinflipGame for the toggle.
 */

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { CoinTossScene } from './CoinTossScene';
import type { Coin3DProps } from './Coin3D';

const Coin3D = dynamic(() => import('./Coin3D'), {
  ssr: false,
  loading: () => <CoinTossScene variant={0} />,
});

export function Coin3DWrapper(props: Coin3DProps) {
  return (
    <Suspense fallback={<CoinTossScene variant={0} />}>
      <Coin3D {...props} />
    </Suspense>
  );
}
