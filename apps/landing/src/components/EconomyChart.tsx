/**
 * "How a coin flip moves the economy" — the brand's deadpan-ironic data-viz block.
 * A plausible-looking correlation between Fairground's per-epoch HEADS rate and a
 * synthetic "global market" index, annotated with manufactured "significant" events.
 * The faint blue right-hand axis ("$2.3B") is the punchline — it makes the bogus
 * correlation read instantly. Astro island, client:visible. Recharts v3.
 */
import { useEffect, useState } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  type TooltipContentProps,
} from 'recharts';

const AMBER = 'oklch(0.78 0.18 65)'; // primary HEADS line
const VRF_LINE = 'oklch(0.65 0.10 240)'; // desaturated blue market line
const TICK = 'rgba(218, 160, 80, 0.40)'; // axis tick labels
const GRID_STROKE = 'rgba(218, 160, 80, 0.06)'; // ghost gridlines
const REF_STROKE = 'rgba(91, 143, 212, 0.28)'; // reference line
const LABEL_FILL = 'rgba(91, 143, 212, 0.55)'; // reference label text
const MONO = 'IBM Plex Mono, monospace';

// Deterministic pseudo-data (pure trig, no Math.random — stable across SSR/hydration).
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

function TerminalTooltip({ active, payload }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length || !payload[0]) return null;
  const d = payload[0].payload as { epoch: number; headsRate: number; marketIndex: number };
  return (
    <div
      style={{
        background: 'rgba(14, 10, 7, 0.90)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderLeft: `2px solid ${AMBER}`,
        borderTop: '1px solid rgba(218,160,80,0.18)',
        borderRight: '1px solid rgba(218,160,80,0.18)',
        borderBottom: '1px solid rgba(218,160,80,0.18)',
        padding: '8px 12px',
        fontFamily: MONO,
        fontSize: '11px',
        letterSpacing: '0.04em',
        lineHeight: 1.65,
        borderRadius: 0,
      }}
    >
      <div style={{ color: 'rgba(218,160,80,0.45)', marginBottom: 2 }}>
        EPOCH {String(d.epoch).padStart(2, '0')}
      </div>
      <div style={{ color: AMBER }}>HEADS {d.headsRate.toFixed(1)}%</div>
      <div style={{ color: VRF_LINE }}>MKT ${d.marketIndex.toFixed(2)}B</div>
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
          <ComposedChart data={DATA} margin={{ top: 14, right: 8, bottom: 8, left: -6 }}>
            <defs>
              <linearGradient id="amberFade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={AMBER} stopOpacity={0.18} />
                <stop offset="95%" stopColor={AMBER} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid
              vertical={false}
              horizontal={true}
              strokeDasharray="1 5"
              stroke={GRID_STROKE}
            />

            <XAxis
              dataKey="epoch"
              tick={{ fill: TICK, fontSize: 10, fontFamily: MONO, letterSpacing: '0.05em' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `EP${String(v).padStart(2, '0')}`}
              minTickGap={28}
            />

            <YAxis
              yAxisId="l"
              domain={[40, 60]}
              tick={{ fill: TICK, fontSize: 10, fontFamily: MONO, letterSpacing: '0.04em', dx: -2 }}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(v: number) => `${v}%`}
            />

            <YAxis
              yAxisId="r"
              orientation="right"
              domain={[1.5, 3]}
              tick={{ fill: 'rgba(91,143,212,0.35)', fontSize: 9, fontFamily: MONO, dx: 4 }}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(v: number) => `$${v.toFixed(1)}B`}
            />

            <Tooltip
              content={<TerminalTooltip />}
              cursor={{ stroke: 'rgba(218,160,80,0.18)', strokeWidth: 1 }}
            />

            {EVENTS.map((e) => (
              <ReferenceLine
                key={e.epoch}
                yAxisId="l"
                x={e.epoch}
                stroke={REF_STROKE}
                strokeDasharray="2 5"
                strokeWidth={1}
                label={{
                  value: e.label,
                  position: 'insideTopRight',
                  fill: LABEL_FILL,
                  fontSize: 9,
                  fontFamily: MONO,
                }}
              />
            ))}

            <Area
              yAxisId="l"
              type="monotone"
              dataKey="headsRate"
              stroke={AMBER}
              strokeWidth={1.5}
              fill="url(#amberFade)"
              fillOpacity={1}
              dot={false}
              isAnimationActive={true}
              animationDuration={1400}
              animationEasing="ease-in-out"
              name="HEADS rate"
            />

            <Line
              yAxisId="r"
              type="monotone"
              dataKey="marketIndex"
              stroke={VRF_LINE}
              strokeWidth={1}
              strokeDasharray="2 4"
              dot={false}
              isAnimationActive={false}
              name="Market index"
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
