import Link from 'next/link';
import { requirePermission } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { DateTime, StatusBadge } from '@/components/status-badge';

export default async function SyncLogPage() {
  await requirePermission('stores.sync.view');
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const { data: runs } = await supabase
    .from('sync_log')
    .select('*, stores(id, name, code)')
    .order('started_at', { ascending: false })
    .limit(100);

  return (
    <>
      <PageHeader title={t.sync.title} subtitle={t.sync.subtitle} />

      <Card>
        {!runs || runs.length === 0 ? (
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
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const store = run.stores as unknown as { id: string; name: string; code: string } | null;
                return (
                  <tr key={run.id} className="hover:bg-surface-muted">
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
                      {run.duration_ms != null ? `${run.duration_ms} ms` : '—'}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
