import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  Badge,
  Breadcrumb,
  Card,
  CardBody,
  CardHeaderRow,
  Detail,
  DetailList,
  EmptyState,
  Meter,
  Notice,
  PageHeader,
  StatTile,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { DateOnly } from '@/components/status-badge';
import { ActionButton } from '@/components/form/action-button';
import { KpiEntryForm, KpiForm, type Option } from './kpi-forms';
import { deleteKpiDefinition } from '../kpi-actions';

/**
 * §Departments detail, with the §KPI tab.
 *
 * The brief puts KPIs on the *parent* department so one manager can see every
 * team beneath them from one place. That is why the KPI tab gathers the whole
 * subtree rather than just this department's direct members.
 */
export default async function DepartmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requirePermission('departments.view');
  const { id } = await params;
  const { tab } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  const active = tab === 'kpi' ? 'kpi' : 'overview';

  const { data: department } = await supabase
    .from('department_tree')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (!department) notFound();

  const canKpiView = can(session, 'kpi.view');
  const canKpiManage = can(session, 'kpi.manage');
  const canKpiRecord = can(session, 'kpi.record');

  // Everything at or beneath this department — the scope a parent's KPIs cover.
  const { data: subtree } = await supabase
    .from('department_tree')
    .select('*')
    .contains('ancestry', [id])
    .order('path');

  const descendantIds = (subtree ?? []).map((row) => row.id);

  const [{ data: definitions }, { data: performance }, { data: teams }, { data: members }] =
    await Promise.all([
      canKpiView
        ? supabase
            .from('kpi_definitions')
            .select('*')
            .in('department_id', descendantIds.length > 0 ? descendantIds : [id])
            .order('sort_order')
        : Promise.resolve({ data: null }),
      canKpiView
        ? supabase
            .from('kpi_performance')
            .select('*')
            .in('owner_department_id', descendantIds.length > 0 ? descendantIds : [id])
            .order('period_start', { ascending: false })
            .limit(200)
        : Promise.resolve({ data: null }),
      supabase.from('teams').select('id, name, department_id').is('archived_at', null).order('name'),
      supabase
        .from('app_users')
        .select('id, full_name, department_id')
        .is('archived_at', null)
        .eq('status', 'active')
        .order('full_name'),
    ]);

  const localeName = (row: { name_en: string; name_ar: string }) =>
    locale === 'ar' ? row.name_ar : row.name_en;

  // Subjects a KPI may target: the sub-departments beneath this one, the teams
  // sitting under any of them, and the people in them.
  const subDepartmentOptions: Option[] = (subtree ?? [])
    .filter((row) => row.id !== id)
    .map((row) => ({ id: row.id, name: `${'  '.repeat(row.depth - department.depth - 1)}${localeName(row)}` }));

  const scopeIds = new Set(descendantIds);
  const teamOptions: Option[] = (teams ?? [])
    .filter((team) => team.department_id && scopeIds.has(team.department_id))
    .map((team) => ({ id: team.id, name: team.name }));
  const memberOptions: Option[] = (members ?? [])
    .filter((user) => user.department_id && scopeIds.has(user.department_id))
    .map((user) => ({ id: user.id, name: user.full_name }));

  const nameOf = (row: { subject: string; department_id: string | null; team_id: string | null; user_id: string | null }) => {
    if (row.subject === 'department') {
      const match = (subtree ?? []).find((d) => d.id === row.department_id);
      return match ? localeName(match) : '—';
    }
    if (row.subject === 'team') return teams?.find((x) => x.id === row.team_id)?.name ?? '—';
    if (row.subject === 'user') return members?.find((x) => x.id === row.user_id)?.full_name ?? '—';
    return '—';
  };

  const rows = performance ?? [];
  const scored = rows.filter((row) => row.achievement_pct != null);
  const averageAchievement =
    scored.length > 0
      ? Math.round(scored.reduce((sum, row) => sum + Number(row.achievement_pct), 0) / scored.length)
      : null;

  const statusTone = (status: string) =>
    status === 'achieved' ? 'success' : status === 'at_risk' ? 'warning' : status === 'missed' ? 'danger' : 'neutral';

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[{ label: t.nav.departments, href: '/departments' }, { label: localeName(department) }]}
          />
        }
        title={localeName(department)}
        subtitle={department.path}
        actions={
          active === 'kpi' && canKpiManage ? <KpiForm departmentId={id} /> : null
        }
      />

      <Tabs
        active={`/departments/${id}?tab=${active}`}
        items={[
          { href: `/departments/${id}?tab=overview`, label: t.common.details },
          ...(canKpiView
            ? [{ href: `/departments/${id}?tab=kpi`, label: t.kpi.title, count: definitions?.length ?? 0 }]
            : []),
        ]}
      />

      {active === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeaderRow title={t.common.details} />
            <CardBody>
              <DetailList className="sm:grid-cols-1">
                <Detail label={t.common.code}>{department.code}</Detail>
                <Detail label={t.org.parentDepartment}>
                  {department.parent_id ? (
                    <Link href={`/departments/${department.parent_id}`} className="text-brand hover:underline">
                      {department.path.split(' / ').slice(-2, -1)[0]}
                    </Link>
                  ) : (
                    t.org.mainDepartment
                  )}
                </Detail>
                <Detail label={t.companies.userCount}>{department.user_count}</Detail>
                <Detail label={t.org.subDepartments}>{department.child_count}</Detail>
                <Detail label={t.common.status}>
                  <Badge tone={department.is_active ? 'success' : 'neutral'}>
                    {department.is_active ? t.common.active : t.common.inactive}
                  </Badge>
                </Detail>
              </DetailList>
            </CardBody>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeaderRow title={t.org.subDepartments} hint={t.org.parentHint} />
            {(subtree ?? []).filter((row) => row.id !== id).length === 0 ? (
              <EmptyState title={t.common.noResults} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t.common.name}</Th>
                    <Th>{t.common.code}</Th>
                    <Th className="text-end">{t.companies.userCount}</Th>
                  </tr>
                </thead>
                <tbody>
                  {(subtree ?? [])
                    .filter((row) => row.id !== id)
                    .map((row) => (
                      <Tr key={row.id}>
                        <Td style={{ paddingInlineStart: `${(row.depth - department.depth) * 1.25 + 1}rem` }}>
                          <Link href={`/departments/${row.id}`} className="text-brand hover:underline">
                            {localeName(row)}
                          </Link>
                        </Td>
                        <Td className="tnum text-ink-muted" dir="ltr">{row.code}</Td>
                        <Td className="tnum text-end text-ink-muted">{row.user_count}</Td>
                      </Tr>
                    ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      ) : null}

      {active === 'kpi' && canKpiView ? (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-4">
            <StatTile label={t.kpi.definitions} value={definitions?.length ?? 0} tone="brand" />
            <StatTile
              label={t.kpi.achieved}
              value={rows.filter((row) => row.status === 'achieved').length}
              tone="success"
            />
            <StatTile
              label={t.kpi.atRisk}
              value={rows.filter((row) => row.status === 'at_risk').length}
              tone="warning"
            />
            <StatTile
              label={t.kpi.missed}
              value={rows.filter((row) => row.status === 'missed').length}
              tone="danger"
            />
          </div>

          {averageAchievement != null ? (
            <Card className="mb-4">
              <CardBody>
                <Meter
                  value={Math.min(averageAchievement, 100)}
                  label={`${t.kpi.averageAchievement} — ${averageAchievement}%`}
                  tone={averageAchievement >= 100 ? 'success' : averageAchievement >= 80 ? 'warning' : 'danger'}
                />
              </CardBody>
            </Card>
          ) : null}

          <Card className="mb-4">
            <CardHeaderRow title={t.kpi.definitions} hint={t.kpi.subtitle} />
            {!definitions || definitions.length === 0 ? (
              <EmptyState title={t.kpi.noKpis} hint={t.kpi.subtitle} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t.common.name}</Th>
                    <Th>{t.kpi.frequency}</Th>
                    <Th>{t.kpi.direction}</Th>
                    <Th className="text-end">{t.kpi.defaultTarget}</Th>
                    <Th>{t.common.status}</Th>
                    {canKpiManage || canKpiRecord ? <Th className="text-end">{t.common.actions}</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {definitions.map((kpi) => (
                    <Tr key={kpi.id}>
                      <Td className="font-medium">
                        {localeName(kpi)}
                        <span className="block text-xs text-ink-subtle" dir="ltr">{kpi.code}</span>
                      </Td>
                      <Td className="text-ink-muted">{t.kpiFrequency[kpi.frequency]}</Td>
                      <Td className="text-ink-muted">{t.kpiDirection[kpi.direction]}</Td>
                      <Td className="tnum text-end text-ink-muted">
                        {kpi.default_target ?? '—'}
                        {kpi.unit ? <span className="ms-1 text-xs">{kpi.unit}</span> : null}
                      </Td>
                      <Td>
                        <Badge tone={kpi.is_active ? 'success' : 'neutral'}>
                          {kpi.is_active ? t.common.active : t.common.inactive}
                        </Badge>
                      </Td>
                      {canKpiManage || canKpiRecord ? (
                        <Td>
                          <div className="flex items-center justify-end gap-1">
                            {canKpiRecord ? (
                              <KpiEntryForm
                                kpiId={kpi.id}
                                kpiName={localeName(kpi)}
                                subDepartments={subDepartmentOptions}
                                teams={teamOptions}
                                users={memberOptions}
                              />
                            ) : null}
                            {canKpiManage ? (
                              <>
                                <KpiForm
                                  departmentId={kpi.department_id}
                                  kpi={{
                                    id: kpi.id,
                                    code: kpi.code,
                                    name_en: kpi.name_en,
                                    name_ar: kpi.name_ar,
                                    unit: kpi.unit,
                                    frequency: kpi.frequency,
                                    direction: kpi.direction,
                                    default_target: kpi.default_target,
                                    description: kpi.description,
                                    sort_order: kpi.sort_order,
                                    is_active: kpi.is_active,
                                  }}
                                />
                                <ActionButton
                                  action={deleteKpiDefinition}
                                  fields={{ id: kpi.id, department_id: id }}
                                  label={t.common.remove}
                                  icon="reject"
                                  confirm={t.common.confirm}
                                  iconOnly
                                />
                              </>
                            ) : null}
                          </div>
                        </Td>
                      ) : null}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeaderRow title={t.kpi.results} hint={t.kpi.resultsHint} />
            {rows.length === 0 ? (
              <EmptyState title={t.common.noResults} hint={t.kpi.resultsHint} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t.kpi.title}</Th>
                    <Th>{t.kpi.subject}</Th>
                    <Th>{t.kpi.period}</Th>
                    <Th className="text-end">{t.kpi.target}</Th>
                    <Th className="text-end">{t.kpi.actual}</Th>
                    <Th className="text-end">{t.kpi.achievement}</Th>
                    <Th>{t.common.status}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <Tr key={row.entry_id}>
                      <Td className="font-medium">{localeName(row)}</Td>
                      <Td className="text-ink-muted">{nameOf(row)}</Td>
                      <Td className="text-ink-muted">
                        <DateOnly value={row.period_start} /> – <DateOnly value={row.period_end} />
                      </Td>
                      <Td className="tnum text-end text-ink-muted">{row.target_value ?? '—'}</Td>
                      <Td className="tnum text-end">{row.actual_value ?? '—'}</Td>
                      <Td className="tnum text-end font-medium">
                        {row.achievement_pct != null ? `${row.achievement_pct}%` : '—'}
                      </Td>
                      <Td>
                        <Badge tone={statusTone(row.status)}>{t.kpiStatus[row.status]}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      ) : null}

      {active === 'kpi' && !canKpiView ? (
        <Notice tone="warning">{t.errors.forbidden}</Notice>
      ) : null}
    </>
  );
}
