import Link from 'next/link';

export type NavTab = 'play' | 'feed' | 'board' | 'pot';

const TABS: Array<{
  key: NavTab;
  href: string;
  marker: string;
  short: string;
  full: string;
}> = [
  { key: 'play', href: '/', marker: '►', short: 'play', full: 'play' },
  { key: 'feed', href: '/feed', marker: '◉', short: 'live', full: 'live feed' },
  { key: 'board', href: '/leaderboard', marker: '◆', short: 'board', full: 'leaderboard' },
  { key: 'pot', href: '/pot', marker: '◎', short: 'pot', full: 'daily pot' },
];

/**
 * NavTabs — the three-surface switcher (game / live feed / leaderboard), shown on every page so
 * the social surfaces are one tap away mid-game. Server-safe (plain links, no hooks); the active
 * tab is passed by the page that renders it.
 */
export function NavTabs({ active }: { active: NavTab }) {
  return (
    <nav
      aria-label="Site sections"
      className="flex w-full max-w-lg items-center justify-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] sm:gap-3 sm:tracking-[0.22em]"
    >
      {TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={isActive ? 'page' : undefined}
            className="border px-3 py-1.5 transition-opacity hover:opacity-80 sm:px-4"
            style={{
              borderColor: isActive ? 'var(--color-primary)' : 'var(--color-border)',
              color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
              background: isActive ? 'var(--color-primary-dim)' : 'transparent',
              boxShadow: isActive ? '0 0 12px oklch(0.78 0.18 65 / 0.15)' : 'none',
            }}
          >
            <span style={{ opacity: isActive ? 1 : 0.6 }}>{t.marker}</span>{' '}
            <span className="sm:hidden">{t.short}</span>
            <span className="hidden sm:inline">{t.full}</span>
          </Link>
        );
      })}
    </nav>
  );
}
