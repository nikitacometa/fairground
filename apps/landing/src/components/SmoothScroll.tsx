/**
 * SmoothScroll — mounts Lenis inertial scrolling once, document-wide, as a client:load
 * island in BaseLayout. `root` attaches Lenis to the page scroll; `anchors` makes in-page
 * `#hash` links glide instead of jump. Renders nothing visible.
 *
 * Disabled under prefers-reduced-motion (returns null → native scroll), and re-evaluated
 * live if the user toggles the OS setting.
 */
import { ReactLenis } from 'lenis/react';
import { useEffect, useState } from 'react';

export default function SmoothScroll() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = (): void => setEnabled(!mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  if (!enabled) return null;

  return (
    <ReactLenis
      root
      options={{
        lerp: 0.09,
        smoothWheel: true,
        syncTouch: false,
        anchors: { offset: -16, duration: 1.1 },
      }}
    />
  );
}
