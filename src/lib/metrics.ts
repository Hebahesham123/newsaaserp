import 'server-only';

import type { StatusBucket } from '@/components/ui/charts';

/**
 * Time-window aggregation for the dashboard.
 *
 * These live outside the page component on purpose: reading the clock inside a
 * component body is an impure render, so the current time is taken once here
 * and every derived figure is computed from that single reading.
 */

export const DAY_MS = 86_400_000;

export type SyncRun = {
  status: string;
  records_received: number;
  records_failed: number;
  started_at: string;
  store_id: string;
};

export type SyncMetrics = {
  buckets: StatusBucket[];
  volumeByDay: number[];
  totalReceived: number;
  successRate: number;
  failedTotal: number;
  failedLast7: number;
  runCount: number;
  windowStartIso: string;
  byStore: { storeId: string; received: number }[];
};

/** Start of the local day, `offset` days before `now`. */
function dayStart(now: number, offset: number): number {
  const date = new Date(now - offset * DAY_MS);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function syncWindowStart(days: number, now = Date.now()): string {
  return new Date(now - days * DAY_MS).toISOString();
}

export function buildSyncMetrics(
  runs: SyncRun[],
  days: number,
  formatDay: (date: Date) => string,
  now = Date.now(),
): SyncMetrics {
  const buckets: StatusBucket[] = [];
  const volumeByDay: number[] = [];

  for (let offset = days - 1; offset >= 0; offset--) {
    const start = dayStart(now, offset);
    const end = start + DAY_MS;

    const inDay = runs.filter((run) => {
      const at = new Date(run.started_at).getTime();
      return at >= start && at < end;
    });

    buckets.push({
      label: formatDay(new Date(start)),
      success: inDay.filter((run) => run.status === 'success').length,
      partial: inDay.filter((run) => run.status === 'partial').length,
      failed: inDay.filter((run) => run.status === 'failed').length,
    });

    volumeByDay.push(inDay.reduce((sum, run) => sum + run.records_received, 0));
  }

  const succeeded = runs.filter((run) => run.status === 'success').length;
  const failed = runs.filter((run) => run.status === 'failed');
  const sevenDaysAgo = now - 7 * DAY_MS;

  const byStoreMap = new Map<string, number>();
  for (const run of runs) {
    byStoreMap.set(run.store_id, (byStoreMap.get(run.store_id) ?? 0) + run.records_received);
  }

  return {
    buckets,
    volumeByDay,
    totalReceived: volumeByDay.reduce((sum, value) => sum + value, 0),
    successRate: runs.length > 0 ? Math.round((succeeded / runs.length) * 100) : 0,
    failedTotal: failed.length,
    failedLast7: failed.filter((run) => new Date(run.started_at).getTime() >= sevenDaysAgo).length,
    runCount: runs.length,
    windowStartIso: syncWindowStart(days, now),
    byStore: [...byStoreMap.entries()]
      .map(([storeId, received]) => ({ storeId, received }))
      .sort((a, b) => b.received - a.received),
  };
}

/** §2.5.4 — whether the failed-login lockout is still in force. */
export function isLockedOut(lockedUntil: string | null, now = Date.now()): boolean {
  return lockedUntil != null && new Date(lockedUntil).getTime() > now;
}
