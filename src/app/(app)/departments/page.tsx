import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { ActionButton } from '@/components/form/action-button';
import { Toolbar } from '@/components/form/toolbar';
import { searchTerm } from '@/lib/filters';
import { DepartmentForm } from './department-form';
import { archiveDepartment } from './actions';
import { TreeRow } from './tree-row';

/**
 * §Departments — the organisational tree.
 *
 * Reads `department_tree`, which already carries depth, a readable path and the
 * child/user counts. Doing the recursion in the database means this page is one
 * query regardless of how deep the hierarchy goes, and the same shape backs the
 * KPI screen's department picker.
 */
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

  const [{ data: tree }, { data: managers }, companiesResult] = await Promise.all([
    supabase.from('department_tree').select('*').order('path'),
    supabase
      .from('app_users')
      .select('id, full_name')
      .eq('status', 'active')
      .is('archived_at', null)
      .order('full_name'),
    session.profile.company_id
      ? Promise.resolve({ data: null })
      : supabase.from('companies').select('id, name_en, name_ar').is('archived_at', null).order('name_en'),
  ]);

  const term = searchTerm(q);
  const showArchived = Boolean(archived);

  // Filtering happens here rather than in the query: hiding a parent would
  // orphan its children visually, so a match keeps its whole ancestor chain.
  const all = tree ?? [];
  const matches = all.filter((row) => {
    if (showArchived !== (row.archived_at != null)) return false;
    if (!term) return true;
    const haystack = `${row.code} ${row.name_en} ${row.name_ar}`.toLowerCase();
    return haystack.includes(term.toLowerCase());
  });

  const keepIds = new Set<string>();
  for (const row of matches) for (const id of row.ancestry) keepIds.add(id);

  const visible = all.filter(
    (row) => keepIds.has(row.id) && showArchived === (row.archived_at != null),
  );

  const localeName = (row: { name_en: string; name_ar: string }) =>
    locale === 'ar' ? row.name_ar : row.name_en;

  const managerOptions = (managers ?? []).map((m) => ({ id: m.id, name: m.full_name }));
  const managerName = (id: string | null) =>
    id ? (managerOptions.find((m) => m.id === id)?.name ?? '—') : '—';

  const companyOptions = session.profile.company_id
    ? undefined
    : (companiesResult.data ?? []).map((c) => ({
        id: c.id,
        name: locale === 'ar' ? c.name_ar : c.name_en,
      }));

  const canManage = can(session, 'departments.manage');

  /** A department may not be re-parented under itself or any of its own descendants. */
  const parentOptionsFor = (departmentId?: string) =>
    all
      .filter((row) => row.archived_at == null)
      .filter((row) => !departmentId || !row.ancestry.includes(departmentId))
      .map((row) => ({
        id: row.id,
        // Non-breaking spaces so the nesting survives inside a <select>.
        name: `${'  '.repeat(row.depth)}${localeName(row)}`,
      }));

  return (
    <>
      <PageHeader
        title={t.nav.departments}
        subtitle={t.org.departmentsSubtitle}
        actions={
          canManage ? (
            <DepartmentForm
              managers={managerOptions}
              parents={parentOptionsFor()}
              companies={companyOptions}
            />
          ) : null
        }
      />

      <Toolbar
        placeholder={t.nav.departments}
        filters={[
          { name: 'archived', label: t.common.archived, options: [{ value: '1', label: t.common.yes }] },
        ]}
      />

      <Card>
        {visible.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.org.departmentsSubtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.name}</Th>
                <Th>{t.common.code}</Th>
                <Th>{t.users.manager}</Th>
                <Th className="text-end">{t.companies.userCount}</Th>
                <Th>{t.common.status}</Th>
                {canManage ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <TreeRow
                      id={row.id}
                      depth={row.depth}
                      name={localeName(row)}
                      childCount={row.child_count}
                      isRoot={row.parent_id === null}
                    />
                  </Td>
                  <Td className="tnum text-ink-muted" dir="ltr">
                    {row.code}
                  </Td>
                  <Td className="text-ink-muted">{managerName(row.manager_id)}</Td>
                  <Td className="tnum text-end text-ink-muted">{row.user_count}</Td>
                  <Td>
                    <Badge tone={row.is_active ? 'success' : 'neutral'}>
                      {row.is_active ? t.common.active : t.common.inactive}
                    </Badge>
                  </Td>
                  {canManage ? (
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <DepartmentForm
                          department={{
                            id: row.id,
                            code: row.code,
                            name_en: row.name_en,
                            name_ar: row.name_ar,
                            manager_id: row.manager_id,
                            parent_id: row.parent_id,
                            description: null,
                            is_active: row.is_active,
                          }}
                          managers={managerOptions}
                          parents={parentOptionsFor(row.id)}
                        />
                        <ActionButton
                          action={archiveDepartment}
                          fields={row.archived_at ? { id: row.id, restore: '1' } : { id: row.id }}
                          label={row.archived_at ? t.common.unarchive : t.common.archive}
                          icon={row.archived_at ? 'restore' : 'archive'}
                          confirm={row.archived_at ? undefined : t.common.archiveConfirm}
                          iconOnly
                        />
                      </div>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {visible.length > 0 ? (
        <p className="mt-3 text-xs text-ink-subtle">
          {t.common.showing} {visible.length} {t.common.results}
        </p>
      ) : null}
    </>
  );
}
