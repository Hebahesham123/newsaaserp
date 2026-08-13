import { requirePermission } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { DateTime } from '@/components/status-badge';
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

export default async function ActivityLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePermission('audit.view');
  const t = await getDictionary();
  const { page } = await searchParams;

  const pageSize = 50;
  const pageNumber = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
  const from = (pageNumber - 1) * pageSize;

  const supabase = await createServerSupabase();
  const { data: entries, count } = await supabase
    .from('audit_log')
    .select('*, app_users!audit_log_actor_id_fkey(full_name)', { count: 'exact' })
    .order('occurred_at', { ascending: false })
    .range(from, from + pageSize - 1);

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <PageHeader title={t.audit.title} subtitle={t.audit.subtitle} />

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
                  <Th>{t.audit.changedFields}</Th>
                  <Th>{t.audit.ipAddress}</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const actor = entry.app_users as unknown as { full_name: string } | null;
                  return (
                    <tr key={entry.id} className="hover:bg-surface-muted">
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
                      <Td className="max-w-64 truncate text-xs text-ink-muted" dir="ltr">
                        {entry.changed_fields?.join(', ') ?? '—'}
                      </Td>
                      <Td className="tnum text-xs text-ink-muted" dir="ltr">
                        {entry.ip_address ?? '—'}
                      </Td>
                    </tr>
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
                  <a href={`/activity-log?page=${pageNumber - 1}`} className="text-brand hover:underline">
                    {t.common.previous}
                  </a>
                ) : null}
                {pageNumber < lastPage ? (
                  <a href={`/activity-log?page=${pageNumber + 1}`} className="text-brand hover:underline">
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
