import { requirePermission, can, applyFieldPolicy } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { DateTime, StatusBadge } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { ActionButton } from '@/components/form/action-button';
import { pickFilter, searchTerm } from '@/lib/filters';
import { isLockedOut } from '@/lib/metrics';
import { LoginAccountForm, RolesForm, UserForm } from './user-form';
import { archiveUser, clearLockout } from './actions';

const STATUSES = [
  'invited', 'activation_pending', 'active', 'on_leave',
  'temporarily_suspended', 'blocked', 'resigned', 'terminated', 'archived',
] as const;

/**
 * The five parties the brief names, in tab order.
 *
 * Warehouse is deliberately absent: warehouse access is a data scope held in
 * `user_data_scopes`, not a kind of user, so it is controlled by permissions
 * rather than by which list a person appears in.
 */
const USER_TYPES = ['company', 'merchant', 'affiliate', 'store', 'supplier'] as const;
type UserTypeTab = (typeof USER_TYPES)[number];

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; archived?: string; tab?: string }>;
}) {
  const session = await requirePermission('users.view');
  const { q, status, archived, tab } = await searchParams;
  const activeTab: UserTypeTab = (USER_TYPES as readonly string[]).includes(tab ?? '')
    ? (tab as UserTypeTab)
    : 'company';
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('app_users')
    .select('*, user_roles(role_id, roles(name_en, name_ar)), departments(name_en, name_ar)')
    .order('full_name');

  const term = searchTerm(q);
  if (term) {
    query = query.or(
      `full_name.ilike.%${term}%,email.ilike.%${term}%,employee_code.ilike.%${term}%,job_title.ilike.%${term}%`,
    );
  }

  const statusFilter = pickFilter(status, STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);
  query = query.eq('user_type', activeTab);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);

  const [{ data: users }, { data: departments }, { data: teams }, { data: merchants }, { data: roles }, companiesResult] =
    await Promise.all([
      query,
      supabase.from('departments').select('id, name_en, name_ar').is('archived_at', null).order('name_en'),
      supabase.from('teams').select('id, name').is('archived_at', null).order('name'),
      supabase.from('merchants').select('id, name').is('archived_at', null).order('name'),
      // Company roles only — templates are platform reference data and are
      // never assigned to a user directly.
      supabase
        .from('roles')
        .select('id, name_en, name_ar, company_id')
        .not('company_id', 'is', null)
        .eq('is_active', true)
        .order('name_en'),
      session.profile.company_id
        ? Promise.resolve({ data: null })
        : supabase.from('companies').select('id, name_en, name_ar').is('archived_at', null).order('name_en'),
    ]);

  // One count per tab. Head-only queries, and RLS already restricts them to what
  // this user may see, so a chip never advertises rows they cannot open.
  const counts = Object.fromEntries(
    await Promise.all(
      USER_TYPES.map(async (type) => {
        const { count } = await supabase
          .from('app_users')
          .select('id', { count: 'exact', head: true })
          .eq('user_type', type)
          .is('archived_at', null);
        return [type, count ?? 0] as const;
      }),
    ),
  ) as Record<UserTypeTab, number>;

  const departmentOptions = (departments ?? []).map((d) => ({
    id: d.id,
    name: locale === 'ar' ? d.name_ar : d.name_en,
  }));
  const teamOptions = (teams ?? []).map((team) => ({ id: team.id, name: team.name }));
  const merchantOptions = (merchants ?? []).map((m) => ({ id: m.id, name: m.name }));
  const roleOptions = (roles ?? []).map((role) => ({
    id: role.id,
    name: locale === 'ar' ? role.name_ar : role.name_en,
  }));
  const managerOptions = (users ?? []).map((u) => ({ id: u.id, name: u.full_name }));
  const companyOptions = (companiesResult.data ?? []).map((c) => ({
    id: c.id,
    name: locale === 'ar' ? c.name_ar : c.name_en,
  }));

  const canEdit = can(session, 'users.edit');
  const canAssignRoles = can(session, 'users.assign_roles');
  const canArchive = can(session, 'users.archive');
  const canCreate = can(session, 'users.create');

  return (
    <>
      <PageHeader
        title={t.users.title}
        subtitle={t.users.subtitle}
        actions={
          canCreate ? (
            <UserForm
              departments={departmentOptions}
              teams={teamOptions}
              managers={managerOptions}
              merchants={merchantOptions}
              roles={roleOptions}
              canAssignRoles={canAssignRoles}
              companies={session.profile.company_id ? undefined : companyOptions}
            />
          ) : null
        }
      />

      <Tabs
        active={`/users?tab=${activeTab}`}
        items={USER_TYPES.map((type) => ({
          href: `/users?tab=${type}`,
          label: t.userType[type],
          count: counts[type],
        }))}
      />

      <Toolbar
        placeholder={t.users.title}
        filters={[
          {
            name: 'status',
            label: t.common.status,
            options: STATUSES.map((value) => ({ value, label: t.status[value] })),
          },
          { name: 'archived', label: t.common.archived, options: [{ value: '1', label: t.common.yes }] },
        ]}
      />

      <Card>
        {!users || users.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.users.inviteHint} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.users.fullName}</Th>
                <Th>{t.common.email}</Th>
                <Th>{t.common.phone}</Th>
                <Th>{t.users.department}</Th>
                <Th>{t.users.roles}</Th>
                <Th>{t.common.status}</Th>
                <Th>{t.users.lastLogin}</Th>
                {canEdit || canAssignRoles || canArchive ? (
                  <Th className="text-end">{t.common.actions}</Th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const roleLinks = (user.user_roles ?? []) as unknown as {
                  role_id: string;
                  roles: { name_en: string; name_ar: string } | null;
                }[];
                const roleNames = roleLinks
                  .map((link) => (locale === 'ar' ? link.roles?.name_ar : link.roles?.name_en))
                  .filter((n): n is string => Boolean(n));
                const assignedRoleIds = roleLinks.map((link) => link.role_id);
                const department = user.departments as unknown as
                  | { name_en: string; name_ar: string }
                  | null;

                // §2.7.3 — phone visibility follows the viewer's field policy,
                // so a Picker sees nothing and an Accountant sees a mask.
                const phone = applyFieldPolicy(session, 'customers', 'phone', user.phone);
                const locked = isLockedOut(user.locked_until);

                return (
                  <Tr key={user.id}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={user.full_name} />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">
                            {user.full_name}
                            {user.is_platform_admin ? (
                              <Badge tone="brand" className="ms-2">
                                {t.users.platform}
                              </Badge>
                            ) : null}
                          </p>
                          <p className="truncate text-xs text-ink-subtle">
                            {user.job_title ?? user.employee_code ?? '—'}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-ink-muted" dir="ltr">
                      {user.email}
                    </Td>
                    <Td className="text-ink-muted" dir="ltr">
                      {phone ?? '—'}
                    </Td>
                    <Td className="text-ink-muted">
                      {department ? (locale === 'ar' ? department.name_ar : department.name_en) : '—'}
                    </Td>
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
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge status={user.status} />
                        {locked ? <Badge tone="danger">{t.users.lockedUntil}</Badge> : null}
                        {user.must_reset_password ? <Badge tone="warning">reset</Badge> : null}
                      </div>
                    </Td>
                    <Td className="text-ink-muted">
                      <DateTime value={user.last_login_at} />
                    </Td>
                    {canEdit || canAssignRoles || canArchive ? (
                      <Td>
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {canAssignRoles && !user.is_platform_admin ? (
                            <RolesForm
                              userId={user.id}
                              userName={user.full_name}
                              roles={roleOptions}
                              assigned={assignedRoleIds}
                            />
                          ) : null}
                          {canCreate && !user.auth_user_id ? (
                            <LoginAccountForm userId={user.id} email={user.email} />
                          ) : null}
                          {canEdit && locked ? (
                            <ActionButton
                              action={clearLockout}
                              fields={{ id: user.id }}
                              label={t.users.unlock}
                              icon="key"
                              iconOnly
                            />
                          ) : null}
                          {canEdit ? (
                            <UserForm
                              user={user}
                              departments={departmentOptions}
                              teams={teamOptions}
                              managers={managerOptions.filter((m) => m.id !== user.id)}
                              merchants={merchantOptions}
                              roles={roleOptions}
                              assignedRoles={assignedRoleIds}
                              canAssignRoles={canAssignRoles}
                            />
                          ) : null}
                          {canArchive && user.id !== session.profile.id ? (
                            <ActionButton
                              action={archiveUser}
                              fields={
                                user.archived_at ? { id: user.id, restore: '1' } : { id: user.id }
                              }
                              label={user.archived_at ? t.common.unarchive : t.common.archive}
                              icon={user.archived_at ? 'restore' : 'archive'}
                              confirm={user.archived_at ? undefined : t.common.archiveConfirm}
                              iconOnly
                            />
                          ) : null}
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

      <p className="mt-3 text-xs text-ink-subtle">{t.users.inviteHint}</p>
    </>
  );
}
