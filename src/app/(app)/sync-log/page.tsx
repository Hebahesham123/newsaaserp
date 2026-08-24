import Link from 'next/link';
import { requirePermission } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, EmptyState, PageHeader, StatTile, Table, Td, Th, Tr } from '@/components/ui';
import { Donut, type DonutSlice } from '@/components/ui/charts';
import { DateTime, StatusBadge } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter } from '@/lib/filters';

const STATUSES = ['running', 'success', 'partial', 'failed'] as const;

const ENTITIES = [
  'orders', 'customers', 'products', 'variants', 'prices', 'inventory',
  'discounts', 'cancellations', 'payment_status', 'fulfillment_status',
  'returns', 'tracking_numbers', 'taxes', 'addresses',
] as const;

const TRIGGERS = ['webhook', 'scheduled', 'manual', 'retry'] as const;

export default async function SyncLogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; entity?: string; trigger_source?: string }>;
}) {
  await requirePermission('stores.sync.view');
  const { status, entity, trigger_source: trigger } = await searchParams;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('sync_log')
    .select('*, stores(id, name, code)')
    .order('started_at', { ascending: false })
    .limit(200);

  const statusFilter = pickFilter(status, STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);

  const entityFilter = pickFilter(entity, ENTITIES);
  if (entityFilter) query = query.eq('entity', entityFilter);

  const triggerFilter = pickFilter(trigger, TRIGGERS);
  if (triggerFilter) query = query.eq('trigger_source', triggerFilter);

  const { data: runs } = await query;
  const rows = runs ?? [];

  const succeeded = rows.filter((run) => run.status === 'success').length;
  const partial = rows.filter((run) => run.status === 'partial').length;
  const failed = rows.filter((run) => run.status === 'failed').length;
  const received = rows.reduce((sum, run) => sum + run.records_received, 0);
  const successRate = rows.length > 0 ? Math.round((succeeded / rows.length) * 100) : 0;

  const slices: DonutSlice[] = [
    { label: t.sync.succeeded, value: succeeded, tone: 'success' },
    { label: t.status.partial, value: partial, tone: 'warning' },
    { label: t.sync.failed, value: failed, tone: 'danger' },
  ];

  return (
    <>
      <PageHeader title={t.sync.title} subtitle={t.sync.subtitle} />

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          <StatTile label={t.dashboard.syncSuccessRate} value={`${successRate}%`} tone="success" />
          <StatTile label={t.sync.failed} value={failed} tone="danger" />
          <StatTile label={t.status.partial} value={partial} tone="warning" />
          <StatTile label={t.sync.received} value={received.toLocaleString('en-GB')} tone="info" />
        </div>

        <Card className="px-5 py-4">
          <p className="mb-3 text-xs font-medium tracking-wide text-ink-muted uppercase">
            {t.common.status}
          </p>
          <Donut slices={slices} caption={t.sync.title} size={120} />
        </Card>
      </div>

      <Toolbar
        filters={[
          {
            name: 'status',
            label: t.common.status,
            options: STATUSES.map((value) => ({ value, label: t.status[value] ?? value })),
          },
          {
            name: 'entity',
            label: t.sync.entity,
            options: ENTITIES.map((value) => ({ value, label: value.replace(/_/g, ' ') })),
          },
          {
            name: 'trigger_source',
            label: t.sync.trigger,
            options: TRIGGERS.map((value) => ({ value, label: value })),
          },
        ]}
      />

      <Card>
        {rows.length === 0 ? (
          <EmptyState
            title={t.common.noResults}
            hint="Trigger a sync from a store to see runs appear here."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.sync.startedAt}</Th>
                <Th>{t.nav.stores}</Th>
                <Th>{t.sync.entity}</Th>
                <Th>{t.sync.trigger}</Th>
                <Th>{t.common.status}</Th>
                <Th className="text-end">{t.sync.received}</Th>
                <Th className="text-end">{t.sync.succeeded}</Th>
                <Th className="text-end">{t.sync.failed}</Th>
                <Th className="text-end">{t.sync.duration}</Th>
                <Th>{t.audit.reason}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((run) => {
                const store = run.stores as unknown as { id: string; name: string; code: string } | null;
                const errors = run.error_details as { message?: string }[] | null;

                return (
                  <Tr key={run.id}>
                    <Td className="text-ink-muted">
                      <DateTime value={run.started_at} />
                    </Td>
                    <Td>
                      {store ? (
                        <Link href={`/stores/${store.id}`} className="text-brand hover:underline">
                          {store.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td className="text-ink-muted">{run.entity}</Td>
                    <Td className="text-ink-muted">{run.trigger_source}</Td>
                    <Td>
                      <StatusBadge status={run.status} />
                    </Td>
                    <Td className="tnum text-end">{run.records_received}</Td>
                    <Td className="tnum text-end text-success">{run.records_succeeded}</Td>
                    <Td className="tnum text-end">
                      {run.records_failed > 0 ? (
                        <span className="text-danger">{run.records_failed}</span>
                      ) : (
                        run.records_failed
                      )}
                    </Td>
                    <Td className="tnum text-end text-ink-muted">
                      {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </Td>
                    <Td className="max-w-56 truncate text-xs text-ink-muted">
                      {Array.isArray(errors) && errors[0]?.message ? errors[0].message : '—'}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <p className="mt-3 text-xs text-ink-subtle">
        {t.common.showing} {rows.length} {t.common.results}
      </p>
    </>
  );
}
