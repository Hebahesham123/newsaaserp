import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { Toolbar } from '@/components/form/toolbar';
import { ActionButton } from '@/components/form/action-button';
import { searchTerm } from '@/lib/filters';
import { DepartmentForm } from './department-form';
import { archiveDepartment } from './actions';

export default async function DepartmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const session = await requirePermission('departments.view');
  const { q, archived } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('departments')
    .select('*, app_users!departments_manager_id_fkey(full_name), teams(count)')
    .order('name_en');

  const term = searchTerm(q);
  if (term) query = query.or(`name_en.ilike.%${term}%,name_ar.ilike.%${term}%,code.ilike.%${term}%`);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);

  const [{ data: departments }, { data: staff }, companiesResult] = await Promise.all([
    query,
    supabase.from('app_users').select('id, full_name').is('archived_at', null).order('full_name'),
    session.profile.company_id
      ? Promise.resolve({ data: null })
      : supabase.from('companies').select('id, name_en, name_ar').is('archived_at', null).order('name_en'),
  ]);

  const managerOptions = (staff ?? []).map((u) => ({ id: u.id, name: u.full_name }));
  const companyOptions = (companiesResult.data ?? []).map((c) => ({
    id: c.id,
    name: locale === 'ar' ? c.name_ar : c.name_en,
  }));

  const canManage = can(session, 'departments.manage');

  return (
    <>
      <PageHeader
        title={t.nav.departments}
        subtitle={t.org.departmentsSubtitle}
        actions={
          canManage ? (
            <DepartmentForm
              managers={managerOptions}
              companies={session.profile.company_id ? undefined : companyOptions}
            />
          ) : null
        }
      />

      <Toolbar placeholder={t.nav.departments} />

      <Card>
        {!departments || departments.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.org.departmentsSubtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.users.manager}</Th>
                <Th>{t.common.description}</Th>
                <Th className="text-end">{t.nav.teams}</Th>
                <Th>{t.common.status}</Th>
                {canManage ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {departments.map((department) => {
                const manager = department.app_users as unknown as { full_name: string } | null;
                const teamCount =
                  (department.teams as unknown as { count: number }[] | null)?.[0]?.count ?? 0;

                return (
                  <Tr key={department.id}>
                    <Td className="tnum font-medium">{department.code}</Td>
                    <Td>
                      {locale === 'ar' ? department.name_ar : department.name_en}
                      <span className="block text-xs text-ink-subtle">
                        {locale === 'ar' ? department.name_en : department.name_ar}
                      </span>
                    </Td>
                    <Td className="text-ink-muted">{manager?.full_name ?? '—'}</Td>
                    <Td className="max-w-72 truncate text-ink-muted">{department.description ?? '—'}</Td>
                    <Td className="tnum text-end">{teamCount}</Td>
                    <Td>
                      <Badge tone={department.is_active ? 'success' : 'neutral'}>
                        {department.is_active ? t.common.active : t.common.inactive}
                      </Badge>
                    </Td>
                    {canManage ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <DepartmentForm department={department} managers={managerOptions} />
                          <ActionButton
                            action={archiveDepartment}
                            fields={
                              department.archived_at
                                ? { id: department.id, restore: '1' }
                                : { id: department.id }
                            }
                            label={department.archived_at ? t.common.unarchive : t.common.archive}
                            icon={department.archived_at ? 'restore' : 'archive'}
                            confirm={department.archived_at ? undefined : t.common.archiveConfirm}
                            iconOnly
                          />
                        </div>
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
