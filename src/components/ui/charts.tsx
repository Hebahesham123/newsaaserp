/**
 * Inline SVG charts. No client JavaScript and no charting dependency: every
 * chart here is a pure function of its data, so it renders on the server with
 * the rest of the page.
 *
 * Conventions that hold across all of them:
 *   · Marks use the --chart-* ramp, which is lightness-separated for CVD and
 *     validated against the surface colour — not the status text tokens.
 *   · Status series always ship a legend with the label AND the number, so
 *     identity never depends on hue alone.
 *   · Every mark carries a <title>, which gives a native hover tooltip and a
 *     screen-reader name without shipping an interaction layer.
 *   · Stacked segments and adjacent bars are separated by a 2px surface gap.
 */
import { cn } from '@/lib/utils';

const GAP = 2;

/* -------------------------------------------------------------------------- */
/* Sparkline — one series, magnitude over time                                */
/* -------------------------------------------------------------------------- */

export function Sparkline({
  values,
  width = 96,
  height = 30,
  label,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  label?: string;
  className?: string;
}) {
  if (values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const pad = 3;
  const usable = height - pad * 2;

  const points = values.map((value, index) => {
    const x = index * stepX;
    const y = pad + usable - ((value - min) / span) * usable;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn('overflow-visible', className)}
      role="img"
      aria-label={label ?? 'trend'}
    >
      {label ? <title>{label}</title> : null}
      <path d={area} className="fill-chart-brand/12" />
      <path
        d={line}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-chart-brand"
      />
      <circle cx={lastX} cy={lastY} r={3} className="fill-chart-brand stroke-surface" strokeWidth={2} />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Stacked status bars — sync runs per day by outcome                          */
/* -------------------------------------------------------------------------- */

export type StatusBucket = {
  label: string;
  success: number;
  partial: number;
  failed: number;
};

export function StatusBars({
  buckets,
  height = 132,
  legend = { success: 'Succeeded', partial: 'Partial', failed: 'Failed' },
}: {
  buckets: StatusBucket[];
  height?: number;
  legend?: { success: string; partial: string; failed: string };
}) {
  const totals = buckets.map((b) => b.success + b.partial + b.failed);
  const max = Math.max(1, ...totals);

  const sums = buckets.reduce(
    (acc, b) => ({
      success: acc.success + b.success,
      partial: acc.partial + b.partial,
      failed: acc.failed + b.failed,
    }),
    { success: 0, partial: 0, failed: 0 },
  );

  const segments = [
    { key: 'success' as const, className: 'fill-chart-success', label: legend.success },
    { key: 'partial' as const, className: 'fill-chart-warning', label: legend.partial },
    { key: 'failed' as const, className: 'fill-chart-danger', label: legend.failed },
  ];

  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }}>
        {buckets.map((bucket, index) => {
          const total = totals[index];
          const barHeight = (total / max) * height;

          return (
            <div key={`${bucket.label}-${index}`} className="flex min-w-0 flex-1 flex-col justify-end">
              <div className="relative w-full" style={{ height: Math.max(barHeight, total > 0 ? 3 : 1) }}>
                {/* Stacked from the baseline up, tallest-priority first. */}
                {(() => {
                  let offset = 0;
                  return segments.map((segment) => {
                    const value = bucket[segment.key];
                    if (value === 0) return null;
                    const segHeight = (value / total) * Math.max(barHeight, 3);
                    const style = {
                      height: Math.max(segHeight - GAP, 1),
                      bottom: offset,
                    };
                    offset += segHeight;
                    return (
                      <div
                        key={segment.key}
                        title={`${bucket.label} · ${segment.label}: ${value}`}
                        className={cn(
                          'absolute inset-x-0 rounded-[3px]',
                          segment.className.replace('fill-', 'bg-'),
                        )}
                        style={style}
                      />
                    );
                  });
                })()}
                {total === 0 ? <div className="absolute inset-x-0 bottom-0 h-px bg-chart-grid" /> : null}
              </div>
              <span className="mt-1.5 truncate text-center text-[10px] text-ink-subtle">{bucket.label}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border pt-2.5">
        {segments.map((segment) => (
          <span key={segment.key} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span className={cn('size-2 rounded-[2px]', segment.className.replace('fill-', 'bg-'))} aria-hidden />
            {segment.label}
            <span className="tnum font-medium text-ink">{sums[segment.key]}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Donut — composition of a whole, with the total in the middle               */
/* -------------------------------------------------------------------------- */

export type DonutSlice = { label: string; value: number; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' };

const DONUT_STROKE: Record<DonutSlice['tone'], string> = {
  success: 'stroke-chart-success',
  warning: 'stroke-chart-warning',
  danger: 'stroke-chart-danger',
  info: 'stroke-chart-info',
  neutral: 'stroke-ink-subtle',
};

const DONUT_BG: Record<DonutSlice['tone'], string> = {
  success: 'bg-chart-success',
  warning: 'bg-chart-warning',
  danger: 'bg-chart-danger',
  info: 'bg-chart-info',
  neutral: 'bg-ink-subtle',
};

export function Donut({
  slices,
  total,
  caption,
  size = 132,
}: {
  slices: DonutSlice[];
  total?: number;
  caption?: string;
  size?: number;
}) {
  const sum = slices.reduce((acc, slice) => acc + slice.value, 0);
  const shown = total ?? sum;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const stroke = 14;

  let cursor = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 140 140" width={size} height={size} role="img" aria-label={caption ?? 'distribution'}>
        <circle cx="70" cy="70" r={radius} fill="none" strokeWidth={stroke} className="stroke-surface-muted" />
        {sum > 0
          ? slices.map((slice) => {
              if (slice.value === 0) return null;
              const fraction = slice.value / sum;
              // A 2px gap between neighbouring arcs keeps the boundary readable
              // without a contrasting outline.
              const length = Math.max(fraction * circumference - GAP, 1);
              const dash = `${length} ${circumference - length}`;
              const offset = -cursor * circumference;
              cursor += fraction;
              return (
                <circle
                  key={slice.label}
                  cx="70"
                  cy="70"
                  r={radius}
                  fill="none"
                  strokeWidth={stroke}
                  strokeDasharray={dash}
                  strokeDashoffset={offset}
                  strokeLinecap="butt"
                  transform="rotate(-90 70 70)"
                  className={DONUT_STROKE[slice.tone]}
                >
                  <title>{`${slice.label}: ${slice.value} (${Math.round(fraction * 100)}%)`}</title>
                </circle>
              );
            })
          : null}
        <text
          x="70"
          y="66"
          textAnchor="middle"
          className="fill-ink text-[26px] font-semibold"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {shown}
        </text>
        {caption ? (
          <text x="70" y="86" textAnchor="middle" className="fill-ink-subtle text-[11px]">
            {caption}
          </text>
        ) : null}
      </svg>

      {/* Doubles as the table view: every slice's exact number is written out. */}
      <ul className="min-w-40 flex-1 space-y-1.5">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center gap-2 text-sm">
            <span className={cn('size-2 shrink-0 rounded-[2px]', DONUT_BG[slice.tone])} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-ink-muted">{slice.label}</span>
            <span className="tnum font-medium text-ink">{slice.value}</span>
            <span className="tnum w-9 text-end text-xs text-ink-subtle">
              {sum > 0 ? `${Math.round((slice.value / sum) * 100)}%` : '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Ranked bars — a horizontal magnitude comparison across few categories      */
/* -------------------------------------------------------------------------- */

export function RankedBars({
  rows,
  unit,
}: {
  rows: { label: string; value: number; hint?: string }[];
  unit?: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">{row.label}</span>
            <span className="tnum shrink-0 font-medium text-ink">
              {row.value.toLocaleString('en-GB')}
              {unit ? <span className="ms-1 text-xs font-normal text-ink-subtle">{unit}</span> : null}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-[3px] bg-surface-muted">
            <div
              className="h-full rounded-[3px] bg-chart-brand"
              style={{ width: `${Math.max((row.value / max) * 100, 1.5)}%` }}
              title={`${row.label}: ${row.value}`}
            />
          </div>
          {row.hint ? <p className="mt-1 text-xs text-ink-subtle">{row.hint}</p> : null}
        </li>
      ))}
    </ul>
  );
}
