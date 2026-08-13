import { requirePermission } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';

export default async function TeamsPage() {
  await requirePermission('teams.view');
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const { data: teams } = await supabase
    .from('teams')
    .select('*, app_users!teams_leader_id_fkey(full_name), departments(name_en), team_members(count)')
    .is('archived_at', null)
    .order('name');

  return (
    <>
      <PageHeader
        title={t.nav.teams}
        subtitle="Teams route work in Phase 3 order assignment — by store, merchant, region and shift (§2.8.2)"
      />

      <Card>
        {!teams || teams.length === 0 ? (
          <EmptyState title={t.common.noResults} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.nav.departments}</Th>
                <Th>Leader</Th>
                <Th className="text-end">Members</Th>
                <Th>Regions</Th>
                <Th>{t.common.status}</Th>
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => {
                const leader = team.app_users as unknown as { full_name: string } | null;
                const department = team.departments as unknown as { name_en: string } | null;
                const memberCount = (team.team_members as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
                return (
                  <tr key={team.id} className="hover:bg-surface-muted">
                    <Td className="tnum font-medium">{team.code}</Td>
                    <Td>{team.name}</Td>
                    <Td className="text-ink-muted">{department?.name_en ?? '—'}</Td>
                    <Td className="text-ink-muted">{leader?.full_name ?? '—'}</Td>
                    <Td className="tnum text-end">{memberCount}</Td>
                    <Td className="text-ink-muted">
                      {team.assigned_regions.length > 0 ? team.assigned_regions.join(', ') : t.common.all}
                    </Td>
                    <Td>
                      <Badge tone={team.is_active ? 'success' : 'neutral'}>
                        {team.is_active ? t.status.active : t.status.archived}
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
