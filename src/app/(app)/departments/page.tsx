import { requirePermission } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';

export default async function DepartmentsPage() {
  await requirePermission('departments.view');
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  const { data: departments } = await supabase
    .from('departments')
    .select('*, app_users!departments_manager_id_fkey(full_name), teams(count)')
    .is('archived_at', null)
    .order('name_en');

  return (
    <>
      <PageHeader title={t.nav.departments} subtitle="Operational departments within the company (§2.8.1)" />

      <Card>
        {!departments || departments.length === 0 ? (
          <EmptyState title={t.common.noResults} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.users.manager}</Th>
                <Th className="text-end">{t.nav.teams}</Th>
                <Th>{t.common.status}</Th>
              </tr>
            </thead>
            <tbody>
              {departments.map((department) => {
                const manager = department.app_users as unknown as { full_name: string } | null;
                const teamCount = (department.teams as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
                return (
                  <tr key={department.id} className="hover:bg-surface-muted">
                    <Td className="tnum font-medium">{department.code}</Td>
                    <Td>{locale === 'ar' ? department.name_ar : department.name_en}</Td>
                    <Td className="text-ink-muted">{manager?.full_name ?? '—'}</Td>
                    <Td className="tnum text-end">{teamCount}</Td>
                    <Td>
                      <Badge tone={department.is_active ? 'success' : 'neutral'}>
                        {department.is_active ? t.status.active : t.status.archived}
                      </Badge>
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
