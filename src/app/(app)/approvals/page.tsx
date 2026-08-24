import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  Badge,
  Card,
  EmptyState,
  Notice,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { DateTime, StatusBadge } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter } from '@/lib/filters';
import { DecideForm } from './decide-form';

const STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

/** §2.7.4 Segregation of Duties — the maker/checker queue. */
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requirePermission('approvals.view');
  const { status } = await searchParams;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('approval_requests')
    .select(
      '*, requester:app_users!approval_requests_requested_by_fkey(full_name), decider:app_users!approval_requests_decided_by_fkey(full_name)',
    )
    .order('requested_at', { ascending: false })
    .limit(200);

  const statusFilter = pickFilter(status, STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);

  const { data: requests } = await query;

  const pending = (requests ?? []).filter((request) => request.status === 'pending');
  const approved = (requests ?? []).filter((request) => request.status === 'approved');
  const rejected = (requests ?? []).filter((request) => request.status === 'rejected');
  const canDecide = can(session, 'approvals.decide');

  return (
    <>
      <PageHeader title={t.approvals.title} subtitle={t.approvals.subtitle} />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatTile label={t.approvals.pendingCount} value={pending.length} tone="warning" />
        <StatTile label={t.status.approved} value={approved.length} tone="success" />
        <StatTile label={t.status.rejected} value={rejected.length} tone="danger" />
      </div>

      <div className="mb-4">
        <Notice tone="info">{t.approvals.sodNotice}</Notice>
      </div>

      <Toolbar
        filters={[
          {
            name: 'status',
            label: t.common.status,
            options: STATUSES.map((value) => ({ value, label: t.status[value] ?? value })),
          },
        ]}
      />

      <Card>
        {!requests || requests.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.approvals.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.approvals.requested}</Th>
                <Th>{t.approvals.requestType}</Th>
                <Th>{t.audit.record}</Th>
                <Th>{t.approvals.requestedBy}</Th>
                <Th>{t.audit.reason}</Th>
                <Th>{t.common.status}</Th>
                <Th>{t.approvals.decidedBy}</Th>
                {canDecide ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const requester = request.requester as unknown as { full_name: string } | null;
                const decider = request.decider as unknown as { full_name: string } | null;
                const ownRequest = request.requested_by === session.profile.id;
                const payload = request.payload as Record<string, unknown> | null;

                return (
                  <Tr key={request.id}>
                    <Td className="text-ink-muted">
                      <DateTime value={request.requested_at} />
                    </Td>
                    <Td>
                      <Badge tone="brand">{request.request_type.replace(/_/g, ' ')}</Badge>
                    </Td>
                    <Td className="font-mono text-xs text-ink-muted" dir="ltr">
                      {request.entity}
                      {payload && Object.keys(payload).length > 0 ? (
                        <span className="mt-0.5 block max-w-56 truncate text-[11px] text-ink-subtle">
                          {Object.entries(payload)
                            .map(([key, value]) => `${key}: ${String(value)}`)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </Td>
                    <Td>{requester?.full_name ?? '—'}</Td>
                    <Td className="max-w-64 text-ink-muted">
                      <span className="line-clamp-2">{request.reason ?? '—'}</span>
                      {request.decision_note ? (
                        <span className="mt-1 block text-xs text-ink-subtle">
                          → {request.decision_note}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <StatusBadge status={request.status} />
                    </Td>
                    <Td className="text-ink-muted">
                      {decider?.full_name ?? '—'}
                      {request.decided_at ? (
                        <span className="block text-xs text-ink-subtle">
                          <DateTime value={request.decided_at} />
                        </span>
                      ) : null}
                    </Td>
                    {canDecide ? (
                      <Td>
                        {request.status === 'pending' ? (
                          ownRequest ? (
                            <span className="block text-end text-xs text-ink-subtle">
                              {t.approvals.ownRequest}
                            </span>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <DecideForm
                                requestId={request.id}
                                summary={request.reason ?? request.request_type}
                                decision="approved"
                                ownRequest={ownRequest}
                              />
                              <DecideForm
                                requestId={request.id}
                                summary={request.reason ?? request.request_type}
                                decision="rejected"
                                ownRequest={ownRequest}
                              />
                            </div>
                          )
                        ) : null}
                      </Td>
                    ) : null}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
