import { requirePermission } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default async function ShiftsPage() {
  await requirePermission('shifts.view');
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const { data: shifts } = await supabase
    .from('shifts')
    .select('*, departments(name_en), shift_members(count)')
    .is('archived_at', null)
    .order('start_time');

  return (
    <>
      <PageHeader title={t.nav.shifts} subtitle="Working hours, breaks and handover rules (§2.8.3)" />

      <Card>
        {!shifts || shifts.length === 0 ? (
          <EmptyState title={t.common.noResults} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.name}</Th>
                <Th>Hours</Th>
                <Th>Days</Th>
                <Th>{t.nav.departments}</Th>
                <Th className="text-end">Members</Th>
                <Th className="text-end">Capacity</Th>
                <Th>{t.common.status}</Th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => {
                const department = shift.departments as unknown as { name_en: string } | null;
                const memberCount = (shift.shift_members as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
                return (
                  <tr key={shift.id} className="hover:bg-surface-muted">
                    <Td className="font-medium">{shift.name}</Td>
                    <Td className="tnum text-ink-muted" dir="ltr">
                      {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}
                    </Td>
                    <Td className="text-xs text-ink-muted">
                      {shift.working_days.length > 0
                        ? shift.working_days.map((d) => DAY_LABELS[d] ?? d).join(' ')
                        : '—'}
                    </Td>
                    <Td className="text-ink-muted">{department?.name_en ?? '—'}</Td>
                    <Td className="tnum text-end">{memberCount}</Td>
                    <Td className="tnum text-end text-ink-muted">{shift.workload_capacity ?? '—'}</Td>
                    <Td>
                      <Badge tone={shift.is_active ? 'success' : 'neutral'}>
                        {shift.is_active ? t.status.active : t.status.archived}
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
