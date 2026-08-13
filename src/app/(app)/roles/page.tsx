import Link from 'next/link';
import { requirePermission } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';

export default async function RolesPage() {
  await requirePermission('roles.view');
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  const { data: roles } = await supabase
    .from('roles')
    .select('*, role_permissions(count), user_roles(count)')
    .order('code');

  return (
    <>
      <PageHeader
        title={t.roles.title}
        subtitle={t.roles.subtitle}
        actions={
          <Link href="/roles/matrix" className="text-sm text-brand hover:underline">
            {t.roles.matrixTitle}
          </Link>
        }
      />

      <Card>
        {!roles || roles.length === 0 ? (
          <EmptyState title={t.common.noResults} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th className="text-end">{t.roles.permissionCount}</Th>
                <Th className="text-end">{t.nav.users}</Th>
                <Th>{t.common.status}</Th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => {
                const permissionCount =
                  (role.role_permissions as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
                const userCount = (role.user_roles as unknown as { count: number }[] | null)?.[0]?.count ?? 0;

                return (
                  <tr key={role.id} className="hover:bg-surface-muted">
                    <Td className="font-mono text-xs text-ink-muted" dir="ltr">
                      {role.code}
                    </Td>
                    <Td className="font-medium">
                      {locale === 'ar' ? role.name_ar : role.name_en}
                      {role.company_id === null ? (
                        <Badge tone="info" className="ms-2">
                          {t.roles.systemTemplate}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="tnum text-end">{permissionCount}</Td>
                    <Td className="tnum text-end">{userCount}</Td>
                    <Td>
                      <Badge tone={role.is_active ? 'success' : 'neutral'}>
                        {role.is_active ? t.status.active : t.status.archived}
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
