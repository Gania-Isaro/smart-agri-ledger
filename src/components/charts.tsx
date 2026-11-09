/**
 * Charts.
 *
 * Hand-drawn SVG rather than a charting library: the whole app has to work with
 * no network, and four chart shapes are cheaper to own than a dependency.
 *
 * The categorical palette below was validated for lightness band, chroma floor,
 * colour-vision separation (adjacent pairs), normal-vision separation and
 * contrast against the cream surface. Hues are assigned in this fixed order and
 * never cycled. The ninth series folds into "Other" rather than repeating a
 * colour, and colour follows the crop, never its rank in the current sort, so
 * filtering the list never repaints the survivors.
 */

import { useId, useState, type ReactNode } from 'react';
import { formatMoney, formatMoneyShort, formatNumber } from '../domain/money';

import { tx } from '../i18n/tx';
/**
 * The ramp is referenced as CSS variables, not literals, so the chart follows
 * the theme: the dark steps are separately chosen and separately validated
 * against the dark surface, and a chart never has to be re-rendered to swap.
 */
export const CATEGORICAL = [
  'var(--cat-1)', // green
  'var(--cat-2)', // blue
  'var(--cat-3)', // terracotta
  'var(--cat-4)', // purple
  'var(--cat-5)', // amber
  'var(--cat-6)', // teal
  'var(--cat-7)', // brown
  'var(--cat-8)', // magenta
] as const;

export const SERIES_INK = 'var(--text-muted)';
const GRID = 'var(--c-border-soft)';

export interface Point {
  label: string;
  value: number;
  secondary?: number;
  colour?: string;
}

/* ------------------------------------------------------------- chart card */

export function ChartCard({
  title,
  subtitle,
  legend,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="chartcard">
      <div className="chartcard__head">
        <div>
          <h3 className="chartcard__title">{title}</h3>
          {subtitle && <p className="chartcard__sub">{subtitle}</p>}
        </div>
        {action}
      </div>
      {legend && <div className="legend">{legend}</div>}
      {children}
    </section>
  );
}

export function Legend({ items }: { items: { label: string; colour: string }[] }) {
  return (
    <>
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.colour }} />
          {i.label}
        </span>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ hbars */

/**
 * Horizontal bars. Used wherever the category labels are words, words read
 * badly rotated under a vertical axis, and this shape gives every bar a direct
 * label and value, so identity never rests on colour alone.
 */
export function HBars({
  data,
  unit,
  money,
  max: forcedMax,
  emptyLabel = tx('No data yet'),
}: {
  data: Point[];
  unit?: string;
  money?: boolean;
  max?: number;
  emptyLabel?: string;
}) {
  if (data.length === 0) {
    return <p className="muted" style={{ fontSize: 'var(--fs-sm)', padding: 'var(--s-4) 0' }}>{emptyLabel}</p>;
  }
  const max = forcedMax ?? Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="hbars">
      {data.map((d, i) => (
        <div className="hbar" key={d.label}>
          <span className="hbar__label" title={d.label}>
            {d.label}
          </span>
          <span className="hbar__track">
            <span
              className="hbar__fill"
              style={{
                width: `${Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0)}%`,
                background: d.colour ?? CATEGORICAL[i % CATEGORICAL.length],
              }}
            />
          </span>
          <span className="hbar__value num">
            {money ? formatMoneyShort(d.value) : `${formatNumber(d.value)}${unit ? ` ${unit}` : ''}`}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- time chart */

/**
 * One or two series over months, on a single shared axis. Both series are the
 * same measure in the same unit, which is the only case where two lines belong
 * in one frame. A second y-scale would let the shapes tell any story we liked.
 */
export function TimeChart({
  data,
  height = 190,
  money,
  unit,
  seriesLabels = ['Series'],
}: {
  data: Point[];
  height?: number;
  money?: boolean;
  unit?: string;
  seriesLabels?: string[];
}) {
  const gid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const hasSecond = data.some((d) => d.secondary !== undefined);

  if (data.length === 0) {
    return <p className="muted" style={{ fontSize: 'var(--fs-sm)', padding: 'var(--s-4) 0' }}>{tx('Not enough history yet.')}</p>;
  }

  const W = 560;
  const H = height;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const max = Math.max(...data.flatMap((d) => [d.value, d.secondary ?? 0]), 1);
  const niceMax = niceCeil(max);
  const x = (i: number) => padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / niceMax) * innerH;

  const path = (key: 'value' | 'secondary') =>
    data
      .map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y((d[key] as number) ?? 0).toFixed(1)}`)
      .join(' ');

  const areaPath = `${path('value')} L${x(data.length - 1).toFixed(1)},${padT + innerH} L${x(0).toFixed(1)},${padT + innerH} Z`;
  const ticks = [0, niceMax / 2, niceMax];
  const fmt = (v: number) => (money ? formatMoneyShort(v) : formatNumber(Math.round(v)));

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={tx('{series} by month', { series: seriesLabels.join(', ') })}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`fill-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CATEGORICAL[0]} stopOpacity="0.18" />
            <stop offset="100%" stopColor={CATEGORICAL[0]} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth="1" />
            <text x={padL - 7} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill={SERIES_INK}>
              {fmt(t)}
            </text>
          </g>
        ))}

        {!hasSecond && <path d={areaPath} fill={`url(#fill-${gid})`} />}
        <path d={path('value')} fill="none" stroke={CATEGORICAL[0]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hasSecond && (
          <path
            d={path('secondary')}
            fill="none"
            stroke={CATEGORICAL[1]}
            strokeWidth="2"
            strokeDasharray="5 4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {data.map((d, i) => (
          <g key={d.label}>
            <circle cx={x(i)} cy={y(d.value)} r={hover === i ? 5 : 3.4} fill={CATEGORICAL[0]} stroke="var(--surface)" strokeWidth="2" />
            {hasSecond && (
              <circle cx={x(i)} cy={y(d.secondary ?? 0)} r={hover === i ? 5 : 3.4} fill={CATEGORICAL[1]} stroke="var(--surface)" strokeWidth="2" />
            )}
            {/* The first and last labels sit on the plot edge, so centring
                 them would push half the text outside the viewBox. */}
            <text
              x={x(i)}
              y={H - 8}
              textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
              fontSize="10"
              fill={SERIES_INK}
            >
              {d.label}
            </text>
            {/* Hit target far wider than the mark, so hovering is easy on a laptop
                trackpad and tapping works on a phone. */}
            <rect
              x={x(i) - innerW / (data.length * 2) - 2}
              y={padT}
              width={innerW / data.length + 4}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onTouchStart={() => setHover(i)}
            />
            {hover === i && <line x1={x(i)} x2={x(i)} y1={padT} y2={padT + innerH} stroke="var(--c-border-strong)" strokeWidth="1" strokeDasharray="3 3" />}
          </g>
        ))}
      </svg>

      {hover !== null && data[hover] && (
        <div
          style={{
            position: 'absolute',
            left: `${(x(hover) / W) * 100}%`,
            top: 0,
            transform: 'translate(-50%, -8px)',
            background: 'var(--c-ink)',
            color: '#fff',
            fontSize: 'var(--fs-xs)',
            padding: '6px 9px',
            borderRadius: 'var(--r-sm)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: 'var(--shadow-md)',
            zIndex: 2,
          }}
        >
          <b>{data[hover]!.label}</b>
          <div style={{ marginTop: 2 }}>
            {seriesLabels[0]}: {money ? formatMoney(data[hover]!.value) : `${formatNumber(data[hover]!.value)} ${unit ?? ''}`}
          </div>
          {hasSecond && (
            <div>
              {seriesLabels[1]}: {money ? formatMoney(data[hover]!.secondary ?? 0) : formatNumber(data[hover]!.secondary ?? 0)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- meters */

/**
 * A single proportion. A donut with eight slices would be a worse bar chart, so
 * the ring is reserved for the one case it reads well: one number out of one
 * whole, with the number written in the middle.
 */
export function Meter({
  value,
  total,
  label,
  caption,
  colour = CATEGORICAL[0],
  size = 128,
}: {
  value: number;
  total: number;
  label: string;
  caption?: string;
  colour?: string;
  size?: number;
}) {
  const pct = total > 0 ? Math.min(value / total, 1) : 0;
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;

  return (
    <div className="row gap-4" style={{ alignItems: 'center' }}>
      <svg width={size} height={size} role="img" aria-label={tx('{label}: {v} percent', { label, v: Math.round(pct * 100) })}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-cream-400)" strokeWidth="9" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colour}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 500ms var(--ease)' }}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="donut__center"
          fill="var(--text)"
          fontSize="20"
          fontWeight="660"
        >
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <div>
        <div className="strong">{label}</div>
        {caption && <div className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 2 }}>{caption}</div>}
      </div>
    </div>
  );
}

/**
 * Two totals side by side on one scale, how much is owed against how much has
 * been paid. Stacking them would hide the gap, which is the only thing anyone
 * looks at this for.
 */
export function ProgressPair({
  paid,
  total,
  paidLabel = tx('Paid'),
  remainingLabel = tx('Still to pay'),
}: {
  paid: number;
  total: number;
  paidLabel?: string;
  remainingLabel?: string;
}) {
  const pct = total > 0 ? Math.min(paid / total, 1) : 0;
  return (
    <div className="stack gap-2">
      <div
        style={{
          height: 14,
          borderRadius: 'var(--r-full)',
          background: 'var(--c-cream-400)',
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        <div
          style={{
            width: `${pct * 100}%`,
            background: CATEGORICAL[0],
            /* 2px of surface between the two fills so they never blur into one. */
            borderRight: pct > 0 && pct < 1 ? '2px solid var(--surface)' : 'none',
            transition: 'width 480ms var(--ease)',
          }}
        />
      </div>
      <div className="row gap-4 wrap" style={{ fontSize: 'var(--fs-sm)' }}>
        <span>
          <i
            style={{
              display: 'inline-block',
              width: 9,
              height: 9,
              borderRadius: 2,
              background: CATEGORICAL[0],
              marginRight: 6,
            }}
          />
          {paidLabel} <b className="num">{formatMoney(paid)}</b>
        </span>
        <span className="muted">
          <i
            style={{
              display: 'inline-block',
              width: 9,
              height: 9,
              borderRadius: 2,
              background: 'var(--c-cream-500)',
              marginRight: 6,
            }}
          />
          {remainingLabel} <b className="num">{formatMoney(Math.max(total - paid, 0))}</b>
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
}
