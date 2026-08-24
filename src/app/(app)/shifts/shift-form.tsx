'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { createShift, updateShift } from './actions';

export type ShiftDraft = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
  department_id: string | null;
  timezone: string;
  workload_capacity: number | null;
  working_days: number[];
  is_active: boolean;
};

/** Postgres `time` comes back as HH:MM:SS; <input type="time"> wants HH:MM. */
function toTimeInput(value: string | null): string | undefined {
  return value ? value.slice(0, 5) : undefined;
}

export function ShiftForm({
  shift,
  departments,
  companies,
}: {
  shift?: ShiftDraft;
  departments: { id: string; name: string }[];
  companies?: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const editing = shift != null;
  const needsCompany = !editing && companies != null;

  const fields: FieldSpec[] = [
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: shift.id }] as FieldSpec[]) : []),
    ...(needsCompany
      ? ([
          {
            kind: 'select',
            name: 'company_id',
            label: t.merchants.company,
            placeholder: t.merchants.selectCompany,
            required: true,
            full: true,
            options: companies.map((company) => ({ value: company.id, label: company.name })),
          },
        ] as FieldSpec[])
      : []),
    { kind: 'text', name: 'name', label: t.common.name, defaultValue: shift?.name, required: true, full: true, placeholder: 'Morning · 09:00-17:00' },
    { kind: 'text', name: 'start_time', label: t.org.startTime, type: 'time', defaultValue: toTimeInput(shift?.start_time ?? null) ?? '09:00', required: true },
    { kind: 'text', name: 'end_time', label: t.org.endTime, type: 'time', defaultValue: toTimeInput(shift?.end_time ?? null) ?? '17:00', required: true },
    { kind: 'text', name: 'break_start', label: t.org.breakStart, type: 'time', defaultValue: toTimeInput(shift?.break_start ?? null) },
    { kind: 'text', name: 'break_end', label: t.org.breakEnd, type: 'time', defaultValue: toTimeInput(shift?.break_end ?? null) },
    {
      kind: 'select',
      name: 'department_id',
      label: t.users.department,
      defaultValue: shift?.department_id,
      options: departments.map((department) => ({ value: department.id, label: department.name })),
    },
    { kind: 'text', name: 'workload_capacity', label: t.common.capacity, type: 'number', min: 1, defaultValue: shift?.workload_capacity },
    { kind: 'text', name: 'timezone', label: t.common.timezone, defaultValue: shift?.timezone ?? 'Africa/Cairo', dir: 'ltr' },
    {
      kind: 'multi',
      name: 'working_days',
      label: t.users.workingDays,
      // 0 = Sunday, matching the working_days smallint[] convention.
      options: t.weekdays.short.map((label, index) => ({ value: String(index), label })),
      selected: (shift?.working_days ?? [0, 1, 2, 3, 4]).map(String),
      columns: 3,
      full: true,
    },
    {
      kind: 'checkbox',
      name: 'is_active',
      label: t.common.active,
      defaultChecked: shift?.is_active ?? true,
      full: true,
    },
  ];

  return (
    <EntityForm
      action={editing ? updateShift : createShift}
      title={editing ? t.org.editShift : t.org.createShift}
      fields={fields}
      trigger={editing ? t.common.edit : t.org.createShift}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
    />
  );
}
