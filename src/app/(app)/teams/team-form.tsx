'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { createTeam, setTeamMembers, updateTeam } from './actions';

export type TeamDraft = {
  id: string;
  code: string;
  name: string;
  department_id: string | null;
  leader_id: string | null;
  shift_id: string | null;
  max_workload_capacity: number | null;
  assigned_store_ids: string[];
  assigned_merchant_ids: string[];
  assigned_regions: string[];
  order_types: string[];
  is_active: boolean;
};

type Option = { id: string; name: string };

export function TeamForm({
  team,
  departments,
  shifts,
  staff,
  stores,
  merchants,
  companies,
}: {
  team?: TeamDraft;
  departments: Option[];
  shifts: Option[];
  staff: Option[];
  stores: Option[];
  merchants: Option[];
  companies?: Option[];
}) {
  const { t } = useI18n();
  const editing = team != null;
  const needsCompany = !editing && companies != null;

  const fields: FieldSpec[] = [
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: team.id }] as FieldSpec[]) : []),
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

    { kind: 'text', name: 'code', label: t.common.code, defaultValue: team?.code, required: true, dir: 'ltr', placeholder: 'CONF-A' },
    { kind: 'text', name: 'name', label: t.common.name, defaultValue: team?.name, required: true },
    {
      kind: 'select',
      name: 'department_id',
      label: t.users.department,
      defaultValue: team?.department_id,
      options: departments.map((d) => ({ value: d.id, label: d.name })),
    },
    {
      kind: 'select',
      name: 'leader_id',
      label: t.org.leader,
      defaultValue: team?.leader_id,
      options: staff.map((s) => ({ value: s.id, label: s.name })),
    },
    {
      kind: 'select',
      name: 'shift_id',
      label: t.org.shift,
      defaultValue: team?.shift_id,
      options: shifts.map((s) => ({ value: s.id, label: s.name })),
    },
    { kind: 'text', name: 'max_workload_capacity', label: t.org.maxCapacity, type: 'number', min: 1, defaultValue: team?.max_workload_capacity },

    { kind: 'section', label: t.org.routing },
    {
      kind: 'multi',
      name: 'assigned_merchant_ids',
      label: t.org.assignedMerchants,
      options: merchants.map((m) => ({ value: m.id, label: m.name })),
      selected: team?.assigned_merchant_ids ?? [],
      columns: 2,
      full: true,
    },
    {
      kind: 'multi',
      name: 'assigned_store_ids',
      label: t.org.assignedStores,
      options: stores.map((s) => ({ value: s.id, label: s.name })),
      selected: team?.assigned_store_ids ?? [],
      columns: 2,
      full: true,
    },
    {
      kind: 'text',
      name: 'assigned_regions',
      label: t.org.regions,
      defaultValue: team?.assigned_regions.join(', '),
      hint: 'Comma separated',
      full: true,
    },
    {
      kind: 'text',
      name: 'order_types',
      label: t.org.orderTypes,
      defaultValue: team?.order_types.join(', '),
      hint: 'Comma separated, e.g. cod, prepaid',
      full: true,
    },
    {
      kind: 'checkbox',
      name: 'is_active',
      label: t.common.active,
      defaultChecked: team?.is_active ?? true,
      full: true,
    },
  ];

  return (
    <EntityForm
      action={editing ? updateTeam : createTeam}
      title={editing ? t.org.editTeam : t.org.createTeam}
      fields={fields}
      trigger={editing ? t.common.edit : t.org.createTeam}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
      size="lg"
    />
  );
}

/** Membership is edited on its own, so adding people does not re-save routing. */
export function TeamMembersForm({
  teamId,
  teamName,
  staff,
  members,
}: {
  teamId: string;
  teamName: string;
  staff: Option[];
  members: string[];
}) {
  const { t } = useI18n();

  return (
    <EntityForm
      action={setTeamMembers}
      title={`${t.org.members} — ${teamName}`}
      fields={[
        { kind: 'hidden', name: 'id', value: teamId },
        {
          kind: 'multi',
          name: 'members',
          label: t.org.members,
          options: staff.map((person) => ({ value: person.id, label: person.name })),
          selected: members,
          columns: 2,
          full: true,
        },
      ]}
      trigger={t.org.members}
      triggerIcon="none"
      triggerVariant="ghost"
      triggerSize="sm"
      submitLabel={t.common.saveChanges}
    />
  );
}
