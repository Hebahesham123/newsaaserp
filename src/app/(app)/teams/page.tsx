import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, Meter, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { Toolbar } from '@/components/form/toolbar';
import { ActionButton } from '@/components/form/action-button';
import { searchTerm } from '@/lib/filters';
import { TeamForm, TeamMembersForm } from './team-form';
import { archiveTeam } from './actions';

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const session = await requirePermission('teams.view');
  const { q, archived } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('teams')
    .select(
      '*, departments(name_en, name_ar), shifts(name), app_users!teams_leader_id_fkey(full_name), team_members(user_id)',
    )
    .order('name');

  const term = searchTerm(q);
  if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);

  const [{ data: teams }, { data: departments }, { data: shifts }, { data: staff }, { data: stores }, { data: merchants }, companiesResult] =
    await Promise.all([
      query,
      supabase.from('departments').select('id, name_en, name_ar').is('archived_at', null).order('name_en'),
      supabase.from('shifts').select('id, name').is('archived_at', null).order('start_time'),
      supabase.from('app_users').select('id, full_name').is('archived_at', null).order('full_name'),
      supabase.from('stores').select('id, name').is('archived_at', null).order('name'),
      supabase.from('merchants').select('id, name').is('archived_at', null).order('name'),
      session.profile.company_id
        ? Promise.resolve({ data: null })
        : supabase.from('companies').select('id, name_en, name_ar').is('archived_at', null).order('name_en'),
    ]);

  const departmentOptions = (departments ?? []).map((d) => ({
    id: d.id,
    name: locale === 'ar' ? d.name_ar : d.name_en,
  }));
  const shiftOptions = (shifts ?? []).map((s) => ({ id: s.id, name: s.name }));
  const staffOptions = (staff ?? []).map((u) => ({ id: u.id, name: u.full_name }));
  const storeOptions = (stores ?? []).map((s) => ({ id: s.id, name: s.name }));
  const merchantOptions = (merchants ?? []).map((m) => ({ id: m.id, name: m.name }));
  const companyOptions = (companiesResult.data ?? []).map((c) => ({
    id: c.id,
    name: locale === 'ar' ? c.name_ar : c.name_en,
  }));

  const canManage = can(session, 'teams.manage');

  return (
    <>
      <PageHeader
        title={t.nav.teams}
        subtitle={t.org.teamsSubtitle}
        actions={
          canManage ? (
            <TeamForm
              departments={departmentOptions}
              shifts={shiftOptions}
              staff={staffOptions}
              stores={storeOptions}
              merchants={merchantOptions}
              companies={session.profile.company_id ? undefined : companyOptions}
            />
          ) : null
        }
      />

      <Toolbar placeholder={t.nav.teams} />

      <Card>
        {!teams || teams.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.org.teamsSubtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.nav.departments}</Th>
                <Th>{t.org.leader}</Th>
                <Th>{t.org.shift}</Th>
                <Th className="text-end">{t.org.members}</Th>
                <Th>{t.org.maxCapacity}</Th>
                <Th>{t.org.routing}</Th>
                <Th>{t.common.status}</Th>
                {canManage ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const department = team.departments as unknown as
                  | { name_en: string; name_ar: string }
                  | null;
                const shift = team.shifts as unknown as { name: string } | null;
                const leader = team.app_users as unknown as { full_name: string } | null;
                const memberRows = (team.team_members ?? []) as unknown as { user_id: string }[];
                const members = memberRows.map((row) => row.user_id);

                return (
                  <Tr key={team.id}>
                    <Td className="tnum font-medium">{team.code}</Td>
                    <Td>{team.name}</Td>
                    <Td className="text-ink-muted">
                      {department ? (locale === 'ar' ? department.name_ar : department.name_en) : '—'}
                    </Td>
                    <Td className="text-ink-muted">{leader?.full_name ?? '—'}</Td>
                    <Td className="text-ink-muted">{shift?.name ?? '—'}</Td>
                    <Td className="tnum text-end">{members.length}</Td>
                    <Td className="min-w-32">
                      {team.max_workload_capacity ? (
                        <Meter
                          value={members.length * 30}
                          max={team.max_workload_capacity}
                          label={`${team.max_workload_capacity}`}
                        />
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {team.assigned_merchant_ids.length > 0 ? (
                          <Badge tone="brand">{team.assigned_merchant_ids.length} {t.nav.merchants}</Badge>
                        ) : null}
                        {team.assigned_store_ids.length > 0 ? (
                          <Badge tone="info">{team.assigned_store_ids.length} {t.nav.stores}</Badge>
                        ) : null}
                        {team.assigned_regions.length > 0 ? (
                          <Badge>{team.assigned_regions.join(', ')}</Badge>
                        ) : null}
                        {team.assigned_merchant_ids.length === 0 &&
                        team.assigned_store_ids.length === 0 &&
                        team.assigned_regions.length === 0 ? (
                          <span className="text-ink-subtle">—</span>
                        ) : null}
                      </div>
                    </Td>
                    <Td>
                      <Badge tone={team.is_active ? 'success' : 'neutral'}>
                        {team.is_active ? t.common.active : t.common.inactive}
                      </Badge>
                    </Td>
                    {canManage ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <TeamMembersForm
                            teamId={team.id}
                            teamName={team.name}
                            staff={staffOptions}
                            members={members}
                          />
                          <TeamForm
                            team={team}
                            departments={departmentOptions}
                            shifts={shiftOptions}
                            staff={staffOptions}
                            stores={storeOptions}
                            merchants={merchantOptions}
                          />
                          <ActionButton
                            action={archiveTeam}
                            fields={team.archived_at ? { id: team.id, restore: '1' } : { id: team.id }}
                            label={team.archived_at ? t.common.unarchive : t.common.archive}
                            icon={team.archived_at ? 'restore' : 'archive'}
                            confirm={team.archived_at ? undefined : t.common.archiveConfirm}
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
