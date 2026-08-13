import { requirePermission, can, applyFieldPolicy } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { DateTime, StatusBadge } from '@/components/status-badge';

export default async function UsersPage() {
  const session = await requirePermission('users.view');
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const { data: users } = await supabase
    .from('app_users')
    .select('*, user_roles(roles(name_en, name_ar))')
    .is('archived_at', null)
    .order('full_name');

  const locale = session.profile.locale;

  return (
    <>
      <PageHeader title={t.users.title} subtitle={t.users.subtitle} />

      <Card>
        {!users || users.length === 0 ? (
          <EmptyState title={t.common.noResults} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.users.fullName}</Th>
                <Th>{t.common.email}</Th>
                <Th>{t.common.phone}</Th>
                <Th>{t.users.jobTitle}</Th>
                <Th>{t.users.roles}</Th>
                <Th>{t.common.status}</Th>
                <Th>{t.users.lastLogin}</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const roleLinks = (user.user_roles ?? []) as unknown as {
                  roles: { name_en: string; name_ar: string } | null;
                }[];
                const roleNames = roleLinks
                  .map((link) => (locale === 'ar' ? link.roles?.name_ar : link.roles?.name_en))
                  .filter((n): n is string => Boolean(n));

                // §2.7.3 — phone visibility follows the viewer's field policy,
                // so a Picker sees nothing and an Accountant sees a mask.
                const phone = applyFieldPolicy(session, 'customers', 'phone', user.phone);

                return (
                  <tr key={user.id} className="hover:bg-surface-muted">
                    <Td className="font-medium">
                      {user.full_name}
                      {user.is_platform_admin ? (
                        <Badge tone="brand" className="ms-2">
                          platform
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="text-ink-muted" dir="ltr">
                      {user.email}
                    </Td>
                    <Td className="text-ink-muted" dir="ltr">
                      {phone ?? '—'}
                    </Td>
                    <Td className="text-ink-muted">{user.job_title ?? '—'}</Td>
                    <Td>
                      {roleNames.length === 0 ? (
                        <span className="text-ink-subtle">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {roleNames.map((name) => (
                            <Badge key={name}>{name}</Badge>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <StatusBadge status={user.status} />
                    </Td>
                    <Td className="text-ink-muted">
                      <DateTime value={user.last_login_at} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {can(session, 'users.create') ? (
        <p className="mt-3 text-xs text-ink-subtle">
          Users are invited by an administrator; self-service registration is rejected by the database
          (§2.5.1).
        </p>
      ) : null}
    </>
  );
}
