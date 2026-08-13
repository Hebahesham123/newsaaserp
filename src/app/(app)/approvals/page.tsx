import { requirePermission } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, EmptyState, Notice, PageHeader, Table, Td, Th } from '@/components/ui';
import { DateTime, StatusBadge } from '@/components/status-badge';

/** §2.7.4 Segregation of Duties — the maker/checker queue. */
export default async function ApprovalsPage() {
  await requirePermission('approvals.view');
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const { data: requests } = await supabase
    .from('approval_requests')
    .select('*, requester:app_users!approval_requests_requested_by_fkey(full_name)')
    .order('requested_at', { ascending: false })
    .limit(100);

  return (
    <>
      <PageHeader title={t.nav.approvals} subtitle="Dual-control requests awaiting a second pair of eyes" />

      <div className="mb-4">
        <Notice tone="info">
          The database refuses to let the same user create and approve a request. Phases 4-6 raise requests
          here for stock adjustments, return dispositions, settlements and invoices.
        </Notice>
      </div>

      <Card>
        {!requests || requests.length === 0 ? (
          <EmptyState title={t.common.noResults} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Requested</Th>
                <Th>Type</Th>
                <Th>{t.audit.record}</Th>
                <Th>Requested by</Th>
                <Th>{t.audit.reason}</Th>
                <Th>{t.common.status}</Th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const requester = request.requester as unknown as { full_name: string } | null;
                return (
                  <tr key={request.id} className="hover:bg-surface-muted">
                    <Td className="text-ink-muted">
                      <DateTime value={request.requested_at} />
                    </Td>
                    <Td className="text-ink-muted">{request.request_type.replace(/_/g, ' ')}</Td>
                    <Td className="font-mono text-xs text-ink-muted" dir="ltr">
                      {request.entity}
                    </Td>
                    <Td>{requester?.full_name ?? '—'}</Td>
                    <Td className="max-w-64 truncate text-ink-muted">{request.reason ?? '—'}</Td>
                    <Td>
                      <StatusBadge status={request.status} />
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
