'use client';

import { Badge, toneForStatus } from '@/components/ui';
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
