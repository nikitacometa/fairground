/**
 * "How a coin flip moves the economy" — the brand's deadpan-ironic data-viz block.
 * A plausible-looking correlation between Fairground's per-epoch HEADS rate and a
 * synthetic "global market" line, annotated with manufactured "significant" events.
 * Astro island, client:visible. Recharts v3.
 */
import { useEffect, useState } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';

const AMBER = '#d4963a';
const VRF = '#5b8fd4';
const MUTED = '#5a3a20';

// Deterministic pseudo-data (no Math.random at module load — stable across renders/SSR).
const DATA = Array.from({ length: 42 }, (_, i) => ({
  epoch: i,
  headsRate: 48 + Math.sin(i * 0.7) * 6 + Math.cos(i * 0.31) * 2.4,
  marketIndex: 2.1 + Math.sin(i * 0.3 + 1) * 0.4 + i * 0.012,
}));

const EVENTS = [
  { epoch: 7, label: 'HEADS×7 · ALGO +2.1%' },
  { epoch: 23, label: 'TAILS DOMINANCE · DXY peaks' },
  { epoch: 38, label: 'HEADS RUN · S&P holds 5300' },
];

interface TipPayload {
  payload: { epoch: number; headsRate: number; marketIndex: number };
}
function TerminalTooltip({ active, payload }: { active?: boolean; payload?: TipPayload[] }) {
  if (!active || !payload || !payload[0]) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: '#0d0906',
        border: `1px solid ${AMBER}`,
        padding: '8px 12px',
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: '11px',
        color: '#f0e8d8',
        lineHeight: 1.6,
      }}
    >
      <div style={{ color: MUTED }}>EPOCH {d.epoch.toString().padStart(2, '0')}</div>
      <div style={{ color: AMBER }}>HEADS {d.headsRate.toFixed(1)}%</div>
      <div style={{ color: VRF }}>MKT idx {d.marketIndex.toFixed(2)}</div>
    </div>
  );
}

export default function EconomyChart() {
  // ResponsiveContainer measures 0 during SSR (no layout) and warns. Reserve the height
  // and only mount the chart client-side; the box keeps its size so there is no shift.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div style={{ width: '100%', height: 340 }}>
      {mounted && (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={DATA} margin={{ top: 10, right: 16, bottom: 8, left: -8 }}>
            <CartesianGrid stroke="rgba(212,150,58,0.06)" vertical={false} />
            <XAxis
              dataKey="epoch"
              tick={{ fill: MUTED, fontSize: 10, fontFamily: 'monospace' }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(212,150,58,0.15)' }}
            />
            <YAxis
              yAxisId="l"
              domain={[40, 60]}
              tick={{ fill: MUTED, fontSize: 10, fontFamily: 'monospace' }}
              tickLine={false}
              axisLine={false}
              width={34}
            />
            <YAxis yAxisId="r" orientation="right" hide domain={[1.5, 3]} />
            <Tooltip content={<TerminalTooltip />} cursor={{ stroke: 'rgba(212,150,58,0.2)' }} />
            {EVENTS.map((e) => (
              <ReferenceLine
                key={e.epoch}
                yAxisId="l"
                x={e.epoch}
                stroke="rgba(91,143,212,0.35)"
                strokeDasharray="3 3"
                label={{
                  value: e.label,
                  position: 'insideTopLeft',
                  fill: MUTED,
                  fontSize: 9,
                  fontFamily: 'monospace',
                }}
              />
            ))}
            <Line
              yAxisId="l"
              type="monotone"
              dataKey="headsRate"
              stroke={AMBER}
              strokeWidth={2}
              dot={false}
              name="HEADS rate"
            />
            <Line
              yAxisId="r"
              type="monotone"
              dataKey="marketIndex"
              stroke={VRF}
              strokeWidth={1.5}
              strokeDasharray="2 2"
              dot={false}
              name="Market index"
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
