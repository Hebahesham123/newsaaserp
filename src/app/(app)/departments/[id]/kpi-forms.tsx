'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { Notice } from '@/components/ui';
import { saveKpiDefinition, saveKpiEntry } from '../kpi-actions';

export type Option = { id: string; name: string };

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly'] as const;
const DIRECTIONS = ['higher_is_better', 'lower_is_better'] as const;

/* -------------------------------------------------------------------------- */
/* KPI definition                                                             */
/* -------------------------------------------------------------------------- */

export type KpiDraft = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  unit: string | null;
  frequency: string;
  direction: string;
  default_target: number | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

export function KpiForm({ departmentId, kpi }: { departmentId: string; kpi?: KpiDraft }) {
  const { t } = useI18n();
  const editing = kpi != null;

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'department_id', value: departmentId },
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: kpi.id }] as FieldSpec[]) : []),

    { kind: 'text', name: 'code', label: t.common.code, defaultValue: kpi?.code, required: true, dir: 'ltr', placeholder: 'confirmation_rate' },
    { kind: 'text', name: 'unit', label: t.kpi.unit, defaultValue: kpi?.unit, placeholder: '%' },
    { kind: 'text', name: 'name_en', label: t.companies.nameEn, defaultValue: kpi?.name_en, required: true },
    { kind: 'text', name: 'name_ar', label: t.companies.nameAr, defaultValue: kpi?.name_ar, required: true, dir: 'rtl' },
    {
      kind: 'select',
      name: 'frequency',
      label: t.kpi.frequency,
      defaultValue: kpi?.frequency ?? 'monthly',
      required: true,
      options: FREQUENCIES.map((value) => ({ value, label: t.kpiFrequency[value] })),
    },
    {
      kind: 'select',
      name: 'direction',
      label: t.kpi.direction,
      defaultValue: kpi?.direction ?? 'higher_is_better',
      required: true,
      options: DIRECTIONS.map((value) => ({ value, label: t.kpiDirection[value] })),
      hint: t.kpi.directionHint,
    },
    {
      kind: 'text',
      name: 'default_target',
      label: t.kpi.defaultTarget,
      type: 'number',
      step: '0.01',
      defaultValue: kpi?.default_target,
      hint: t.kpi.defaultTargetHint,
    },
    { kind: 'text', name: 'sort_order', label: t.catalog.sortOrder, type: 'number', defaultValue: kpi?.sort_order ?? 0 },
    { kind: 'textarea', name: 'description', label: t.common.description, defaultValue: kpi?.description, rows: 2 },
    { kind: 'checkbox', name: 'is_active', label: t.common.active, defaultChecked: kpi?.is_active ?? true },
  ];

  return (
    <EntityForm
      action={saveKpiDefinition}
      title={editing ? t.kpi.editKpi : t.kpi.createKpi}
      fields={fields}
      trigger={editing ? t.common.edit : t.kpi.createKpi}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
      size="lg"
    />
  );
}

/* -------------------------------------------------------------------------- */
/* One recorded period                                                        */
/* -------------------------------------------------------------------------- */

export type EntryDraft = {
  id: string;
  subject: string;
  subject_id: string;
  period_start: string;
  period_end: string;
  target_value: number | null;
  actual_value: number | null;
  note: string | null;
};

export function KpiEntryForm({
  kpiId,
  kpiName,
  subDepartments,
  teams,
  users,
  entry,
}: {
  kpiId: string;
  kpiName: string;
  subDepartments: Option[];
  teams: Option[];
  users: Option[];
  entry?: EntryDraft;
}) {
  const { t } = useI18n();
  const editing = entry != null;

  // The subject list is one flat select rather than a type picker plus a second
  // dependent select: the type is implied by which group the choice came from,
  // and a two-step picker for at most a few dozen options is friction for no
  // gain. The hidden `subject` below is derived from the chosen id.
  const subjectOptions = [
    ...subDepartments.map((d) => ({ value: `department:${d.id}`, label: `${t.kpi.subjectDepartment} — ${d.name}` })),
    ...teams.map((team) => ({ value: `team:${team.id}`, label: `${t.kpi.subjectTeam} — ${team.name}` })),
    ...users.map((user) => ({ value: `user:${user.id}`, label: `${t.kpi.subjectUser} — ${user.name}` })),
  ];

  const currentSubject = editing ? `${entry.subject}:${entry.subject_id}` : undefined;

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'kpi_id', value: kpiId },
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: entry.id }] as FieldSpec[]) : []),

    {
      kind: 'select',
      name: 'subject_ref',
      label: t.kpi.subject,
      defaultValue: currentSubject,
      required: true,
      full: true,
      options: subjectOptions,
    },
    { kind: 'text', name: 'period_start', label: t.kpi.periodStart, type: 'date', defaultValue: entry?.period_start, required: true },
    { kind: 'text', name: 'period_end', label: t.kpi.periodEnd, type: 'date', defaultValue: entry?.period_end, required: true },
    { kind: 'text', name: 'target_value', label: t.kpi.target, type: 'number', step: '0.01', defaultValue: entry?.target_value, hint: t.kpi.targetHint },
    { kind: 'text', name: 'actual_value', label: t.kpi.actual, type: 'number', step: '0.01', defaultValue: entry?.actual_value },
    { kind: 'textarea', name: 'note', label: t.common.notes, defaultValue: entry?.note, rows: 2 },
  ];

  return (
    <EntityForm
      action={saveKpiEntry}
      title={editing ? t.kpi.editResult : t.kpi.recordResult}
      description={kpiName}
      fields={fields}
      trigger={editing ? t.common.edit : t.kpi.recordResult}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'secondary'}
      triggerSize="sm"
      submitLabel={editing ? t.common.saveChanges : t.common.save}
      size="lg"
      banner={
        subjectOptions.length === 0 ? (
          <Notice tone="warning">{t.kpi.noSubjects}</Notice>
        ) : undefined
      }
    />
  );
}
