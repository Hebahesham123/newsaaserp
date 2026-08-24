import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* Layout primitives                                                          */
/* -------------------------------------------------------------------------- */

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {breadcrumb ? <div className="mb-2">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-ink-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Breadcrumb({ items }: { items: { label: string; href?: Route }[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-xs text-ink-subtle">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-1.5">
          {index > 0 ? <span aria-hidden>/</span> : null}
          {item.href ? (
            <Link href={item.href} className="hover:text-ink">
              {item.label}
            </Link>
          ) : (
            <span className="text-ink-muted">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-card border border-border bg-surface shadow-xs', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('border-b border-border px-5 py-4', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-sm font-semibold text-ink', className)} {...props} />;
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-wrap items-center gap-2 border-t border-border px-5 py-3', className)}
      {...props}
    />
  );
}

/** Header row for a card that carries an action on the end side. */
export function CardHeaderRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <CardHeader className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <CardTitle>{title}</CardTitle>
        {hint ? <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </CardHeader>
  );
}

/* -------------------------------------------------------------------------- */
/* Data display                                                               */
/* -------------------------------------------------------------------------- */

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      className={cn(
        'border-b border-border bg-surface-muted px-4 py-2.5 text-start text-xs font-medium tracking-wide text-ink-muted uppercase',
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('border-b border-border px-4 py-3 align-middle text-ink', className)} {...props} />;
}

export function Tr({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('transition-colors hover:bg-surface-muted', className)} {...props} />;
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-14 text-center">
      <p className="text-sm font-medium text-ink-muted">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-md text-xs text-ink-subtle">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** One row of a detail sheet. Shared by every entity detail page. */
export function Detail({ label, children }: { label: string; children?: ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="border-b border-border py-2.5 last:border-0">
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{empty ? '—' : children}</dd>
    </div>
  );
}

export function DetailList({ className, ...props }: ComponentProps<'dl'>) {
  return <dl className={cn('grid gap-x-8 sm:grid-cols-2', className)} {...props} />;
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-ink',
        className,
      )}
    >
      {initials || '—'}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-neutral-soft text-ink-muted',
  brand: 'bg-brand-soft text-brand-ink',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

const TONE_FG: Record<Tone, string> = {
  neutral: 'text-ink-muted',
  brand: 'text-brand',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_CLASS[tone],
        className,
      )}
      {...props}
    />
  );
}

/** A small coloured dot — cheaper than a badge when the label is adjacent. */
export function Dot({ tone = 'neutral', className }: { tone?: Tone; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-1.5 rounded-full bg-current', TONE_FG[tone], className)}
    />
  );
}

/**
 * Maps every status value across the spec's five status enums to a tone.
 * Kept in one place so a status reads the same in every table it appears in.
 */
export function toneForStatus(status: string): Tone {
  switch (status) {
    case 'active':
    case 'connected':
    case 'success':
    case 'approved':
    case 'ready_for_go_live':
    // §4.3 the two terminal-good order states.
    case 'confirmed':
    case 'ready_for_warehouse':
    case 'paid':
    case 'delivered':
      return 'success';
    case 'draft':
    case 'not_connected':
    case 'lead':
    case 'invited':
    case 'activation_pending':
    case 'archived':
    case 'disconnected':
      return 'neutral';
    case 'under_review':
    case 'contracting':
    case 'onboarding':
    case 'connection_in_progress':
    case 'running':
    case 'pending':
    case 'on_leave':
    // §4.3 confirmation stage — work in progress on a live order.
    case 'assigned':
    case 'first_call':
    case 'second_call':
    case 'third_call':
    case 'whatsapp_confirmation':
    case 'callback':
    case 'sent':
    case 'read':
      return 'info';
    case 'suspended':
    case 'temporarily_suspended':
    case 'temporarily_blocked':
    case 'on_hold':
    case 'payment_overdue':
    case 'partial':
    // §3.11 / §3.5 — a catalog item that needs someone to act on it.
    case 'out_of_stock':
    case 'unmapped':
    case 'conflict':
    // §4.3 verification stage — the order is held pending a check.
    case 'duplicate_check':
    case 'fraud_check':
    case 'customer_history_review':
    case 'queued':
      return 'warning';
    case 'cancelled':
    case 'contract_terminated':
    case 'connection_error':
    case 'failed':
    case 'blocked':
    case 'rejected':
    case 'subscription_expired':
    case 'terminated':
    case 'resigned':
    case 'discontinued':
    case 'sync_error':
    case 'error':
      return 'danger';
    case 'mapped':
      return 'success';
    default:
      return 'neutral';
  }
}

/* -------------------------------------------------------------------------- */
/* Forms & actions                                                            */
/* -------------------------------------------------------------------------- */

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55';

const BUTTON_VARIANT = {
  primary: 'bg-brand text-brand-contrast hover:bg-brand-hover',
  secondary: 'border border-border-strong bg-surface text-ink hover:bg-surface-muted',
  ghost: 'text-ink-muted hover:bg-surface-muted hover:text-ink',
  danger: 'bg-danger text-brand-contrast hover:opacity-90',
  subtle: 'bg-surface-muted text-ink hover:bg-surface-raised',
} as const;

const BUTTON_SIZE = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2',
} as const;

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & {
  variant?: keyof typeof BUTTON_VARIANT;
  size?: keyof typeof BUTTON_SIZE;
}) {
  return (
    <button
      className={cn(BUTTON_BASE, BUTTON_SIZE[size], BUTTON_VARIANT[variant], className)}
      {...props}
    />
  );
}

/** Anchor styled as a button, for navigation that looks like an action. */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: keyof typeof BUTTON_VARIANT;
  size?: keyof typeof BUTTON_SIZE;
}) {
  return (
    <Link
      className={cn(BUTTON_BASE, BUTTON_SIZE[size], BUTTON_VARIANT[variant], className)}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">
        {label}
        {required ? <span className="ms-1 text-danger">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-ink-subtle">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL =
  'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none disabled:opacity-60';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(CONTROL, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(CONTROL, 'pe-8', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(CONTROL, 'min-h-24', className)} {...props} />;
}

/** Checkbox with its label on one line, for booleans inside dense forms. */
export function Checkbox({
  label,
  hint,
  className,
  ...props
}: ComponentProps<'input'> & { label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 py-1.5">
      <input
        type="checkbox"
        className={cn(
          'mt-0.5 size-4 shrink-0 rounded border-border-strong bg-surface accent-[var(--brand)]',
          className,
        )}
        {...props}
      />
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {hint ? <span className="block text-xs text-ink-subtle">{hint}</span> : null}
      </span>
    </label>
  );
}

/** Multi-select rendered as a checkbox grid — a native multiple select is unusable. */
export function CheckboxGroup({
  name,
  options,
  selected,
  columns = 2,
}: {
  name: string;
  options: { value: string; label: string }[];
  selected?: string[];
  columns?: 1 | 2 | 3;
}) {
  const set = new Set(selected ?? []);
  return (
    <div
      className={cn(
        'grid gap-x-4 rounded-lg border border-border bg-surface px-3 py-2',
        columns === 1 ? 'grid-cols-1' : columns === 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-3',
      )}
    >
      {options.map((option) => (
        <Checkbox
          key={option.value}
          name={name}
          value={option.value}
          label={option.label}
          defaultChecked={set.has(option.value)}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback                                                                   */
/* -------------------------------------------------------------------------- */

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('rounded-lg px-4 py-3 text-sm', TONE_CLASS[tone])}>
      {title ? <p className="mb-0.5 font-semibold">{title}</p> : null}
      <div className="opacity-90">{children}</div>
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'brand',
  icon,
  trend,
  chart,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: Tone;
  icon?: ReactNode;
  /** Signed percentage change; rendered green when up, red when down. */
  trend?: { value: number; label?: string };
  chart?: ReactNode;
}) {
  return (
    <Card className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">{label}</p>
        {icon ? (
          <span className={cn('shrink-0 rounded-lg p-1.5', TONE_CLASS[tone])}>{icon}</span>
        ) : null}
      </div>

      <p className="tnum mt-2 text-2xl font-semibold text-ink">{value}</p>

      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {trend ? (
            <p
              className={cn(
                'tnum text-xs font-medium',
                trend.value > 0 ? 'text-success' : trend.value < 0 ? 'text-danger' : 'text-ink-subtle',
              )}
            >
              {trend.value > 0 ? '▲' : trend.value < 0 ? '▼' : '■'} {Math.abs(trend.value).toFixed(1)}%
              {trend.label ? <span className="ms-1 text-ink-subtle">{trend.label}</span> : null}
            </p>
          ) : null}
          {hint ? <p className="truncate text-xs text-ink-subtle">{hint}</p> : null}
        </div>
        {chart ? <div className="shrink-0">{chart}</div> : null}
      </div>
    </Card>
  );
}

/** Horizontal meter for a ratio — used for capacity, quota and health bars. */
export function Meter({
  value,
  max = 100,
  tone = 'brand',
  label,
  className,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  label?: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const barTone =
    tone === 'brand' && pct >= 90 ? 'danger' : tone === 'brand' && pct >= 75 ? 'warning' : tone;

  const FILL: Record<Tone, string> = {
    neutral: 'bg-ink-subtle',
    brand: 'bg-brand',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    info: 'bg-info',
  };

  return (
    <div className={className}>
      {label ? (
        <div className="mb-1 flex items-center justify-between gap-2 text-xs text-ink-subtle">
          <span>{label}</span>
          <span className="tnum">{Math.round(pct)}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
      >
        <div className={cn('h-full rounded-full transition-[width]', FILL[barTone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                 */
/* -------------------------------------------------------------------------- */

/** Tab strip built from links so each tab is a real, shareable URL. */
export function Tabs({
  items,
  active,
}: {
  items: { href: Route; label: string; count?: number }[];
  active: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
      {items.map((item) => {
        const isActive = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors',
              isActive
                ? 'border-brand font-medium text-ink'
                : 'border-transparent text-ink-muted hover:border-border-strong hover:text-ink',
            )}
          >
            {item.label}
            {item.count != null ? (
              <span className="tnum rounded-full bg-surface-muted px-1.5 py-0.5 text-xs text-ink-muted">
                {item.count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
