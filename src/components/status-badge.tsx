'use client';

import { Badge, toneForStatus, type Tone } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import type { Dictionary } from '@/i18n/dictionaries/en';

type StatusKey = keyof Dictionary['status'];

function isStatusKey(value: string, dict: Dictionary): value is StatusKey {
  return value in dict.status;
}

/** Renders any of the spec's status values, translated and consistently toned. */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useI18n();
  if (!status) return <span className="text-ink-subtle">—</span>;

  const label = isStatusKey(status, t) ? t.status[status] : status.replace(/_/g, ' ');
  return <Badge tone={toneForStatus(status)}>{label}</Badge>;
}

/**
 * §3.11 product statuses live in their own dictionary rather than `status`,
 * because the spec fixes a different list for them than for companies and
 * merchants. The tone mapping is shared, so a status reads the same everywhere.
 */
export function ProductStatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useI18n();
  if (!status) return <span className="text-ink-subtle">—</span>;

  const key = status as keyof Dictionary['productStatus'];
  return <Badge tone={toneForStatus(status)}>{t.productStatus[key] ?? status.replace(/_/g, ' ')}</Badge>;
}

export function MappingStatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useI18n();
  if (!status) return <span className="text-ink-subtle">—</span>;

  const key = status as keyof Dictionary['mappingStatus'];
  return <Badge tone={toneForStatus(status)}>{t.mappingStatus[key] ?? status}</Badge>;
}

/**
 * §4.3 order statuses. Like product statuses these have their own dictionary,
 * because the spec fixes a different list for them.
 */
export function OrderStatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useI18n();
  if (!status) return <span className="text-ink-subtle">—</span>;

  const key = status as keyof Dictionary['orderStatus'];
  return <Badge tone={toneForStatus(status)}>{t.orderStatus[key] ?? status.replace(/_/g, ' ')}</Badge>;
}

export function OrderSourceLabel({ source }: { source: string }) {
  const { t } = useI18n();
  const key = source as keyof Dictionary['orderSource'];
  return <span>{t.orderSource[key] ?? source.replace(/_/g, ' ')}</span>;
}

export function OrderStageLabel({ stage }: { stage: string }) {
  const { t } = useI18n();
  const key = stage as keyof Dictionary['orderStage'];
  return <span>{t.orderStage[key] ?? stage}</span>;
}

export function CallOutcomeBadge({ outcome }: { outcome: string }) {
  const { t } = useI18n();
  const key = outcome as keyof Dictionary['callOutcome'];

  // A confirmed call is a good outcome; an unreachable customer is not a
  // failure of the agent, so only genuinely bad outcomes read as danger.
  const tone =
    outcome === 'confirmed' ? 'success'
    : outcome === 'cancelled' || outcome === 'wrong_number' || outcome === 'invalid_number' ? 'danger'
    : outcome === 'callback_requested' || outcome === 'postponed' ? 'info'
    : 'warning';

  return <Badge tone={tone}>{t.callOutcome[key] ?? outcome.replace(/_/g, ' ')}</Badge>;
}

export function PaymentMethodLabel({ method }: { method: string }) {
  const { t } = useI18n();
  const key = method as keyof Dictionary['paymentMethod'];
  return <span>{t.paymentMethod[key] ?? method.replace(/_/g, ' ')}</span>;
}

/**
 * §4.13 risk indicator. The thresholds are the ones the scoring function in
 * 0012 produces: a blacklist hit alone lands at 40, and a customer who cancels
 * most of what they order climbs past 60.
 */
export function RiskBadge({ score }: { score: number }) {
  const { t } = useI18n();
  if (score <= 0) return <span className="text-ink-subtle">—</span>;

  const tone = score >= 60 ? 'danger' : score >= 30 ? 'warning' : 'neutral';
  return (
    <Badge tone={tone} title={t.customers.riskExplain}>
      {score}
    </Badge>
  );
}

export function ProductTypeLabel({ type }: { type: string }) {
  const { t } = useI18n();
  const key = type as keyof Dictionary['productType'];
  return <span>{t.productType[key] ?? type.replace(/_/g, ' ')}</span>;
}

/**
 * Amount with its currency code. Rendered client-side so the digits follow the
 * viewer's locale, matching how dates are handled above.
 */
export function Money({
  amount,
  currency,
  className,
}: {
  amount: number | null | undefined;
  currency?: string | null;
  className?: string;
}) {
  const { formatNumber } = useI18n();
  if (amount == null) return <span className="text-ink-subtle">—</span>;

  return (
    <span className={`tnum whitespace-nowrap ${className ?? ''}`}>
      {formatNumber(amount)}
      {currency ? <span className="ms-1 text-xs text-ink-subtle">{currency}</span> : null}
    </span>
  );
}

/**
 * Phases 4–7 add nine more status enums, each with its own dictionary section.
 * One generic badge rather than nine near-identical components: the tone still
 * comes from `toneForStatus`, so a status reads the same colour everywhere.
 */
type EnumSection =
  | 'shipmentStatus' | 'returnStatus' | 'collectionStatus' | 'statementStatus'
  | 'expenseStatus' | 'settlementStatus' | 'invoiceStatus' | 'taskStatus'
  | 'taskPriority' | 'returnDisposition' | 'inventoryTxnType' | 'warehouseTaskType'
  | 'marketingPlatform' | 'reportCategory';

export function EnumBadge({
  section,
  value,
  tone,
}: {
  section: EnumSection;
  value: string | null | undefined;
  /** Overrides the shared status tone — for enums that are not statuses. */
  tone?: Tone;
}) {
  const { t } = useI18n();
  if (!value) return <span className="text-ink-subtle">—</span>;

  const dict = t[section] as Record<string, string>;
  return (
    <Badge tone={tone ?? toneForStatus(value)}>{dict[value] ?? value.replace(/_/g, ' ')}</Badge>
  );
}

/** The same lookup without the badge chrome, for dense table cells. */
export function EnumLabel({
  section,
  value,
}: {
  section: EnumSection;
  value: string | null | undefined;
}) {
  const { t } = useI18n();
  if (!value) return <span className="text-ink-subtle">—</span>;

  const dict = t[section] as Record<string, string>;
  return <span>{dict[value] ?? value.replace(/_/g, ' ')}</span>;
}

export function PlatformLabel({ platform }: { platform: string }) {
  const { t } = useI18n();
  const key = platform as keyof Dictionary['platform'];
  return <span>{t.platform[key] ?? platform}</span>;
}

export function OperatingModelLabel({ model }: { model: string }) {
  const { t } = useI18n();
  const key = model as keyof Dictionary['operatingModel'];
  return <span>{t.operatingModel[key] ?? model}</span>;
}

/** Locale-aware datetime, rendered client-side so it uses the viewer's calendar. */
export function DateTime({ value }: { value: string | null | undefined }) {
  const { formatDateTime } = useI18n();
  return <span className="tnum whitespace-nowrap">{formatDateTime(value)}</span>;
}

export function DateOnly({ value }: { value: string | null | undefined }) {
  const { formatDate } = useI18n();
  return <span className="tnum whitespace-nowrap">{formatDate(value)}</span>;
}
