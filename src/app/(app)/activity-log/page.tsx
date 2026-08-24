import { requirePermission } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { DateTime } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter, searchTerm } from '@/lib/filters';
import type { AuditAction } from '@/lib/supabase/database.types';

const ACTION_TONE: Partial<Record<AuditAction, 'success' | 'info' | 'warning' | 'danger' | 'neutral'>> = {
  create: 'success',
  update: 'info',
  status_change: 'info',
  archive: 'warning',
  delete: 'danger',
  permission_change: 'warning',
  team_membership_change: 'info',
  login_failed: 'danger',
  export: 'warning',
  sensitive_view: 'warning',
  financial_change: 'warning',
  approve: 'success',
  reject: 'danger',
};

const ACTIONS = [
  'create', 'update', 'archive', 'delete', 'status_change', 'permission_change',
  'team_membership_change', 'login', 'logout', 'login_failed', 'password_change',
  'store_connect', 'store_disconnect', 'integration_change',
  'export', 'sensitive_view', 'financial_change', 'approve', 'reject',
] as const;

export default async function ActivityLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; action?: string; module?: string }>;
}) {
  await requirePermission('audit.view');
  const t = await getDictionary();
  const { page, q, action, module } = await searchParams;

  const pageSize = 50;
  const pageNumber = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const from = (pageNumber - 1) * pageSize;

  const supabase = await createServerSupabase();

  let query = supabase
    .from('audit_log')
    .select('*, app_users!audit_log_actor_id_fkey(full_name)', { count: 'exact' })
    .order('occurred_at', { ascending: false });

  const actionFilter = pickFilter(action, ACTIONS);
  if (actionFilter) query = query.eq('action', actionFilter);

  const term = searchTerm(q);
  if (term) query = query.or(`module.ilike.%${term}%,record_id.ilike.%${term}%`);
  if (module) query = query.eq('module', module);

  const { data: entries, count } = await query.range(from, from + pageSize - 1);

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  // Carry the active filters into the pager so paging does not reset them.
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (action) params.set('action', action);
    if (module) params.set('module', module);
    params.set('page', String(target));
    return `/activity-log?${params}`;
  };

  return (
    <>
      <PageHeader title={t.audit.title} subtitle={t.audit.subtitle} />

      <Toolbar
        placeholder={t.audit.module}
        filters={[
          {
            name: 'action',
            label: t.audit.action,
            options: ACTIONS.map((value) => ({ value, label: value.replace(/_/g, ' ') })),
          },
        ]}
      />

      <Card>
        {!entries || entries.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.audit.subtitle} />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>{t.audit.when}</Th>
                  <Th>{t.audit.actor}</Th>
                  <Th>{t.audit.action}</Th>
                  <Th>{t.audit.module}</Th>
                  <Th>{t.audit.record}</Th>
                  <Th>{t.audit.changedFields}</Th>
                  <Th>{t.audit.ipAddress}</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const actor = entry.app_users as unknown as { full_name: string } | null;
                  return (
                    <Tr key={entry.id}>
                      <Td className="text-ink-muted">
                        <DateTime value={entry.occurred_at} />
                      </Td>
                      <Td>{actor?.full_name ?? <span className="text-ink-subtle">system</span>}</Td>
                      <Td>
                        <Badge tone={ACTION_TONE[entry.action] ?? 'neutral'}>
                          {entry.action.replace(/_/g, ' ')}
                        </Badge>
                      </Td>
                      <Td className="font-mono text-xs text-ink-muted" dir="ltr">
                        {entry.module}
                      </Td>
                      <Td className="font-mono text-xs text-ink-subtle" dir="ltr">
                        {entry.record_id ? `${entry.record_id.slice(0, 8)}…` : '—'}
                      </Td>
                      <Td className="max-w-64 truncate text-xs text-ink-muted" dir="ltr">
                        {entry.changed_fields?.join(', ') ?? '—'}
                      </Td>
                      <Td className="tnum text-xs text-ink-muted" dir="ltr">
                        {entry.ip_address ?? '—'}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>

            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-ink-muted">
              <span className="tnum">
                {t.common.page} {pageNumber} {t.common.of} {lastPage} · {total}
              </span>
              <div className="flex gap-3">
                {pageNumber > 1 ? (
                  <a href={pageHref(pageNumber - 1)} className="text-brand hover:underline">
                    {t.common.previous}
                  </a>
                ) : null}
                {pageNumber < lastPage ? (
                  <a href={pageHref(pageNumber + 1)} className="text-brand hover:underline">
                    {t.common.next}
                  </a>
                ) : null}
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
