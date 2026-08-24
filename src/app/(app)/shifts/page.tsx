import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { Toolbar } from '@/components/form/toolbar';
import { ActionButton } from '@/components/form/action-button';
import { searchTerm } from '@/lib/filters';
import { ShiftForm } from './shift-form';
import { archiveShift } from './actions';

export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const session = await requirePermission('shifts.view');
  const { q, archived } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('shifts')
    .select('*, departments(name_en, name_ar), shift_members(count)')
    .order('start_time');

  const term = searchTerm(q);
  if (term) query = query.ilike('name', `%${term}%`);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);

  const [{ data: shifts }, { data: departments }, companiesResult] = await Promise.all([
    query,
    supabase
      .from('departments')
      .select('id, name_en, name_ar')
      .is('archived_at', null)
      .order('name_en'),
    session.profile.company_id
      ? Promise.resolve({ data: null })
      : supabase.from('companies').select('id, name_en, name_ar').is('archived_at', null).order('name_en'),
  ]);

  const departmentOptions = (departments ?? []).map((d) => ({
    id: d.id,
    name: locale === 'ar' ? d.name_ar : d.name_en,
  }));
  const companyOptions = (companiesResult.data ?? []).map((c) => ({
    id: c.id,
    name: locale === 'ar' ? c.name_ar : c.name_en,
  }));

  const canManage = can(session, 'shifts.manage');

  return (
    <>
      <PageHeader
        title={t.nav.shifts}
        subtitle={t.org.shiftsSubtitle}
        actions={
          canManage ? (
            <ShiftForm
              departments={departmentOptions}
              companies={session.profile.company_id ? undefined : companyOptions}
            />
          ) : null
        }
      />

      <Toolbar placeholder={t.nav.shifts} />

      <Card>
        {!shifts || shifts.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.org.shiftsSubtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.name}</Th>
                <Th>{t.org.startTime} – {t.org.endTime}</Th>
                <Th>{t.users.workingDays}</Th>
                <Th>{t.nav.departments}</Th>
                <Th className="text-end">{t.org.members}</Th>
                <Th className="text-end">{t.common.capacity}</Th>
                <Th>{t.common.status}</Th>
                {canManage ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => {
                const department = shift.departments as unknown as
                  | { name_en: string; name_ar: string }
                  | null;
                const memberCount =
                  (shift.shift_members as unknown as { count: number }[] | null)?.[0]?.count ?? 0;

                return (
                  <Tr key={shift.id}>
                    <Td className="font-medium">{shift.name}</Td>
                    <Td className="tnum text-ink-muted" dir="ltr">
                      {shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}
                      {shift.break_start && shift.break_end ? (
                        <span className="block text-xs text-ink-subtle">
                          break {shift.break_start.slice(0, 5)}–{shift.break_end.slice(0, 5)}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {shift.working_days.length === 0 ? (
                          <span className="text-ink-subtle">—</span>
                        ) : (
                          shift.working_days.map((day) => (
                            <Badge key={day} tone="brand" className="text-[10px]">
                              {t.weekdays.short[day] ?? day}
                            </Badge>
                          ))
                        )}
                      </div>
                    </Td>
                    <Td className="text-ink-muted">
                      {department ? (locale === 'ar' ? department.name_ar : department.name_en) : '—'}
                    </Td>
                    <Td className="tnum text-end">{memberCount}</Td>
                    <Td className="tnum text-end text-ink-muted">{shift.workload_capacity ?? '—'}</Td>
                    <Td>
                      <Badge tone={shift.is_active ? 'success' : 'neutral'}>
                        {shift.is_active ? t.common.active : t.common.inactive}
                      </Badge>
                    </Td>
                    {canManage ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <ShiftForm shift={shift} departments={departmentOptions} />
                          <ActionButton
                            action={archiveShift}
                            fields={
                              shift.archived_at ? { id: shift.id, restore: '1' } : { id: shift.id }
                            }
                            label={shift.archived_at ? t.common.unarchive : t.common.archive}
                            icon={shift.archived_at ? 'restore' : 'archive'}
                            confirm={shift.archived_at ? undefined : t.common.archiveConfirm}
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
