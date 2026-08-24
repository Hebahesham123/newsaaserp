'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { createRole, updateRole } from './actions';

export type RoleDraft = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  description: string | null;
  is_active: boolean;
  company_id: string | null;
};

export function RoleForm({
  role,
  companies,
}: {
  role?: RoleDraft;
  companies?: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const editing = role != null;
  const needsCompany = !editing && companies != null;

  const fields: FieldSpec[] = [
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: role.id }] as FieldSpec[]) : []),
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
    {
      kind: 'text',
      name: 'code',
      label: t.common.code,
      defaultValue: role?.code,
      required: true,
      dir: 'ltr',
      placeholder: 'shift_supervisor',
      hint: 'Lower-case, underscore separated.',
    },
    { kind: 'text', name: 'name_ar', label: t.companies.nameAr, defaultValue: role?.name_ar, required: true },
    { kind: 'text', name: 'name_en', label: t.companies.nameEn, defaultValue: role?.name_en, required: true, dir: 'ltr' },
    { kind: 'textarea', name: 'description', label: t.common.description, defaultValue: role?.description },
    ...(editing
      ? ([
          {
            kind: 'checkbox',
            name: 'is_active',
            label: t.common.active,
            defaultChecked: role.is_active,
            hint: 'An inactive role grants nothing, even where it is still assigned.',
            full: true,
          },
        ] as FieldSpec[])
      : []),
  ];

  return (
    <EntityForm
      action={editing ? updateRole : createRole}
      title={editing ? t.roles.editTitle : t.roles.createTitle}
      fields={fields}
      trigger={editing ? t.common.edit : t.roles.createTitle}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
    />
  );
}
