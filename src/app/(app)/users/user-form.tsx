'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { Notice } from '@/components/ui';
import { assignRoles, createLoginAccount, inviteUser, updateUser } from './actions';

export type UserDraft = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  employee_code: string | null;
  job_title: string | null;
  user_type: string | null;
  department_id: string | null;
  team_id: string | null;
  manager_id: string | null;
  merchant_id: string | null;
  locale: string;
  timezone: string;
  hire_date: string | null;
  system_access_start_date: string | null;
  max_assigned_orders: number | null;
  working_days: number[];
  status: string;
  must_reset_password: boolean;
  notes: string | null;
};

type Option = { id: string; name: string };

const STATUSES = [
  'invited', 'activation_pending', 'active', 'on_leave',
  'temporarily_suspended', 'blocked', 'resigned', 'terminated', 'archived',
] as const;

const USER_TYPES = ['employee', 'merchant', 'contractor', 'integration'] as const;

function commonFields(
  t: ReturnType<typeof useI18n>['t'],
  user: UserDraft | undefined,
  options: {
    departments: Option[];
    teams: Option[];
    managers: Option[];
    merchants: Option[];
  },
): FieldSpec[] {
  return [
    { kind: 'section', label: t.companies.identity },
    { kind: 'text', name: 'full_name', label: t.users.fullName, defaultValue: user?.full_name, required: true },
    {
      kind: 'text',
      name: 'email',
      label: t.common.email,
      type: 'email',
      defaultValue: user?.email,
      required: true,
      dir: 'ltr',
      // The email is what links this row to an auth account, so changing it on
      // a claimed user would orphan the link.
      readOnly: user != null,
      hint: user != null ? 'The email is fixed once the account exists.' : undefined,
    },
    { kind: 'text', name: 'phone', label: t.common.phone, type: 'tel', defaultValue: user?.phone, dir: 'ltr' },
    { kind: 'text', name: 'employee_code', label: t.users.employeeCode, defaultValue: user?.employee_code, dir: 'ltr' },
    { kind: 'text', name: 'job_title', label: t.users.jobTitle, defaultValue: user?.job_title },
    {
      kind: 'select',
      name: 'user_type',
      label: t.users.userType,
      defaultValue: user?.user_type ?? 'employee',
      options: USER_TYPES.map((type) => ({ value: type, label: type })),
    },

    { kind: 'section', label: t.users.employment },
    {
      kind: 'select',
      name: 'department_id',
      label: t.users.department,
      defaultValue: user?.department_id,
      options: options.departments.map((d) => ({ value: d.id, label: d.name })),
    },
    {
      kind: 'select',
      name: 'team_id',
      label: t.users.team,
      defaultValue: user?.team_id,
      options: options.teams.map((team) => ({ value: team.id, label: team.name })),
    },
    {
      kind: 'select',
      name: 'manager_id',
      label: t.users.manager,
      defaultValue: user?.manager_id,
      options: options.managers.map((m) => ({ value: m.id, label: m.name })),
    },
    {
      kind: 'select',
      name: 'merchant_id',
      label: t.stores.merchant,
      defaultValue: user?.merchant_id,
      hint: 'Set for merchant-side users, so their data scope follows the merchant.',
      options: options.merchants.map((m) => ({ value: m.id, label: m.name })),
    },
    { kind: 'text', name: 'hire_date', label: t.users.hireDate, type: 'date', defaultValue: user?.hire_date },
    { kind: 'text', name: 'system_access_start_date', label: t.users.accessStart, type: 'date', defaultValue: user?.system_access_start_date },
    { kind: 'text', name: 'max_assigned_orders', label: t.users.maxOrders, type: 'number', min: 1, defaultValue: user?.max_assigned_orders },
    {
      kind: 'select',
      name: 'locale',
      label: t.common.locale,
      defaultValue: user?.locale ?? 'ar',
      required: true,
      options: [
        { value: 'ar', label: 'العربية' },
        { value: 'en', label: 'English' },
      ],
    },
    { kind: 'text', name: 'timezone', label: t.common.timezone, defaultValue: user?.timezone ?? 'Africa/Cairo', dir: 'ltr' },
    {
      kind: 'multi',
      name: 'working_days',
      label: t.users.workingDays,
      options: t.weekdays.short.map((label, index) => ({ value: String(index), label })),
      selected: (user?.working_days ?? [0, 1, 2, 3, 4]).map(String),
      columns: 3,
      full: true,
    },
    { kind: 'textarea', name: 'notes', label: t.common.notes, defaultValue: user?.notes },
  ];
}

export function UserForm({
  user,
  departments,
  teams,
  managers,
  merchants,
  roles,
  assignedRoles,
  companies,
  canAssignRoles,
}: {
  user?: UserDraft;
  departments: Option[];
  teams: Option[];
  managers: Option[];
  merchants: Option[];
  roles: Option[];
  assignedRoles?: string[];
  companies?: Option[];
  canAssignRoles: boolean;
}) {
  const { t } = useI18n();
  const editing = user != null;
  const needsCompany = !editing && companies != null;

  const fields: FieldSpec[] = [
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: user.id }] as FieldSpec[]) : []),
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

    ...commonFields(t, user, { departments, teams, managers, merchants }),

    ...(editing
      ? ([
          { kind: 'section', label: t.users.accessAndSecurity },
          {
            kind: 'select',
            name: 'status',
            label: t.common.status,
            defaultValue: user.status,
            required: true,
            options: STATUSES.map((status) => ({ value: status, label: t.status[status] })),
          },
          {
            kind: 'checkbox',
            name: 'must_reset_password',
            label: t.users.forceReset,
            defaultChecked: user.must_reset_password,
          },
        ] as FieldSpec[])
      : []),

    // On invite, roles can be granted in the same step; afterwards they are
    // managed on their own so an ordinary profile edit cannot change access.
    ...(!editing && canAssignRoles
      ? ([
          { kind: 'section', label: t.users.assignRoles },
          {
            kind: 'multi',
            name: 'roles',
            label: t.users.roles,
            options: roles.map((role) => ({ value: role.id, label: role.name })),
            selected: assignedRoles ?? [],
            columns: 2,
            full: true,
          },
        ] as FieldSpec[])
      : []),
  ];

  return (
    <EntityForm
      action={editing ? updateUser : inviteUser}
      title={editing ? t.users.editTitle : t.users.invite}
      description={editing ? user.email : undefined}
      fields={fields}
      trigger={editing ? t.common.edit : t.users.invite}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.users.invite}
      size="lg"
      banner={editing ? undefined : <Notice tone="info">{t.users.inviteHint}</Notice>}
    />
  );
}

export function RolesForm({
  userId,
  userName,
  roles,
  assigned,
}: {
  userId: string;
  userName: string;
  roles: Option[];
  assigned: string[];
}) {
  const { t } = useI18n();

  return (
    <EntityForm
      action={assignRoles}
      title={`${t.users.assignRoles} — ${userName}`}
      description={t.users.assignRolesHint}
      fields={[
        { kind: 'hidden', name: 'id', value: userId },
        {
          kind: 'multi',
          name: 'roles',
          label: t.users.roles,
          options: roles.map((role) => ({ value: role.id, label: role.name })),
          selected: assigned,
          columns: 2,
          full: true,
        },
      ]}
      trigger={t.users.roles}
      triggerIcon="none"
      triggerVariant="ghost"
      triggerSize="sm"
      submitLabel={t.common.saveChanges}
    />
  );
}

/** Hands an invited user a working password instead of waiting for signup. */
export function LoginAccountForm({ userId, email }: { userId: string; email: string }) {
  const { t } = useI18n();

  return (
    <EntityForm
      action={createLoginAccount}
      title={t.users.createLogin}
      description={email}
      fields={[
        { kind: 'hidden', name: 'id', value: userId },
        {
          kind: 'text',
          name: 'password',
          label: t.users.temporaryPassword,
          type: 'text',
          required: true,
          dir: 'ltr',
          hint: 'At least 10 characters. Share it over a channel the user already trusts.',
          full: true,
        },
      ]}
      trigger={t.users.createLogin}
      triggerIcon="none"
      triggerVariant="ghost"
      triggerSize="sm"
      submitLabel={t.common.create}
      size="sm"
      banner={<Notice tone="warning">{t.users.createLoginHint}</Notice>}
    />
  );
}
