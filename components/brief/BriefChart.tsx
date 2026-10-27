'use client';

import type { BriefChart as ChartData } from '@/lib/brief/types';

const W = 520;
const H = 200;
const PAD = { l: 44, r: 14, t: 14, b: 30 };

function fmt(v: number): string {
  if (Math.abs(v) >= 1000) return v.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  return v.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
}

/** Holographic SVG chart — line or bar. Scales with the card (vector). */
export function BriefChart({ chart }: { chart: ChartData }) {
  const values = chart.series.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (chart.kind === 'bar') min = Math.min(0, min);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  // Bars keep their zero baseline; lines get breathing room on both sides.
  if (chart.kind !== 'bar' || min < 0) min -= span * 0.08;
  max += span * 0.08;

  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const n = chart.series.length;
  const xAt = (i: number) =>
    chart.kind === 'bar' ? PAD.l + (iw / n) * (i + 0.5) : PAD.l + (n === 1 ? iw / 2 : (iw / (n - 1)) * i);
  const yAt = (v: number) => PAD.t + ih - ((v - min) / (max - min)) * ih;
  const ticks = [0, 0.5, 1].map((t) => min + (max - min) * t);
  const labelEvery = Math.ceil(n / 8);
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const lineColor = last < first ? '#FF6B6B' : last > first ? '#4CE0A0' : 'var(--holo-bright)';

  const path = chart.series.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${xAt(n - 1).toFixed(1)},${PAD.t + ih} L${xAt(0).toFixed(1)},${PAD.t + ih} Z`;

  return (
    <figure style={{ margin: 0 }}>
      <figcaption
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          color: 'var(--holo-text)',
          marginBottom: 4,
          gap: 8,
        }}
      >
        <span style={{ fontWeight: 700 }}>{chart.title}</span>
        {chart.unit && <span style={{ color: 'var(--holo-text-dim)' }}>단위 · {chart.unit}</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="brief-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yAt(t)} y2={yAt(t)} stroke="rgba(140,220,255,0.18)" strokeDasharray="3 4" />
            <text x={PAD.l - 6} y={yAt(t) + 4} textAnchor="end" fontSize="10" fill="rgba(180,230,255,0.7)">
              {fmt(t)}
            </text>
          </g>
        ))}
        {chart.kind === 'line' ? (
          <>
            <path d={area} fill="url(#brief-area)" />
            <path
              d={path}
              fill="none"
              stroke={lineColor}
              strokeWidth="2.5"
              strokeLinejoin="round"
              style={{ filter: `drop-shadow(0 0 6px ${lineColor})` }}
            />
            {chart.series.map((p, i) => (
              <circle key={i} cx={xAt(i)} cy={yAt(p.value)} r={i === n - 1 ? 4.5 : 2.5} fill={lineColor}>
                <title>{`${p.label}: ${fmt(p.value)}${chart.unit ?? ''}`}</title>
              </circle>
            ))}
            <text x={xAt(n - 1)} y={yAt(last) - 10} textAnchor="end" fontSize="12" fontWeight="700" fill={lineColor}>
              {fmt(last)}
            </text>
          </>
        ) : (
          chart.series.map((p, i) => {
            const bw = (iw / n) * 0.62;
            const y0 = yAt(Math.max(0, min));
            const y1 = yAt(p.value);
            const color = p.value < 0 ? '#FF6B6B' : 'var(--holo-bright)';
            return (
              <g key={i}>
                <rect
                  x={xAt(i) - bw / 2}
                  y={Math.min(y0, y1)}
                  width={bw}
                  height={Math.max(1, Math.abs(y1 - y0))}
                  fill={color}
                  opacity="0.75"
                  rx="3"
                >
                  <title>{`${p.label}: ${fmt(p.value)}${chart.unit ?? ''}`}</title>
                </rect>
                <text x={xAt(i)} y={Math.min(y0, y1) - 5} textAnchor="middle" fontSize="10" fill="rgba(220,245,255,0.95)">
                  {fmt(p.value)}
                </text>
              </g>
            );
          })
        )}
        {chart.series.map((p, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={i} x={xAt(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="rgba(180,230,255,0.75)">
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
      {chart.note && (
        <div style={{ fontSize: 10, color: 'var(--holo-text-dim)', marginTop: 2 }}>※ {chart.note}</div>
      )}
    </figure>
  );
}
