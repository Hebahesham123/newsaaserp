import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { Toolbar } from '@/components/form/toolbar';
import { searchTerm } from '@/lib/filters';
import { RoleForm } from './role-form';

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; scope?: string }>;
}) {
  const session = await requirePermission('roles.view');
  const { q, scope } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('roles')
    .select('*, role_permissions(count), user_roles(count)')
    .order('code');

  const term = searchTerm(q);
  if (term) query = query.or(`code.ilike.%${term}%,name_en.ilike.%${term}%,name_ar.ilike.%${term}%`);
  if (scope === 'company') query = query.not('company_id', 'is', null);
  if (scope === 'template') query = query.is('company_id', null);

  const [{ data: roles }, companiesResult] = await Promise.all([
    query,
    session.profile.company_id
      ? Promise.resolve({ data: null })
      : supabase.from('companies').select('id, name_en, name_ar').is('archived_at', null).order('name_en'),
  ]);

  const companyOptions = (companiesResult.data ?? []).map((c) => ({
    id: c.id,
    name: locale === 'ar' ? c.name_ar : c.name_en,
  }));

  const canManage = can(session, 'roles.manage');

  return (
    <>
      <PageHeader
        title={t.roles.title}
        subtitle={t.roles.subtitle}
        actions={
          <>
            {canManage ? (
              <RoleForm companies={session.profile.company_id ? undefined : companyOptions} />
            ) : null}
            {canManage ? (
              <ButtonLink href="/roles/matrix" variant="secondary">
                {t.roles.matrixTitle}
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <Toolbar
        placeholder={t.roles.title}
        filters={[
          {
            name: 'scope',
            label: t.common.type,
            options: [
              { value: 'company', label: t.roles.scopeCompany },
              { value: 'template', label: t.roles.scopeTemplate },
            ],
          },
        ]}
      />

      <Card>
        {!roles || roles.length === 0 ? (
          <EmptyState
            title={t.common.noResults}
            hint="Roles are provisioned automatically when a company is created."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.common.description}</Th>
                <Th className="text-end">{t.roles.permissionCount}</Th>
                <Th className="text-end">{t.nav.users}</Th>
                <Th>{t.common.status}</Th>
                {canManage ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const permissionCount =
                  (role.role_permissions as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
                const userCount =
                  (role.user_roles as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
                const isTemplate = role.company_id === null;

                return (
                  <Tr key={role.id}>
                    <Td className="font-mono text-xs text-ink-muted" dir="ltr">
                      {role.code}
                    </Td>
                    <Td className="font-medium">
                      {locale === 'ar' ? role.name_ar : role.name_en}
                      {isTemplate ? (
                        <Badge tone="info" className="ms-2">
                          {t.roles.systemTemplate}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="max-w-72 truncate text-ink-muted">{role.description ?? '—'}</Td>
                    <Td className="tnum text-end">{permissionCount}</Td>
                    <Td className="tnum text-end">{userCount}</Td>
                    <Td>
                      <Badge tone={role.is_active ? 'success' : 'neutral'}>
                        {role.is_active ? t.common.active : t.common.inactive}
                      </Badge>
                    </Td>
                    {canManage ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          {isTemplate ? (
                            <span className="text-xs text-ink-subtle">{t.roles.scopeTemplate}</span>
                          ) : (
                            <RoleForm role={role} />
                          )}
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
