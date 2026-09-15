'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { createDepartment, updateDepartment } from './actions';

export type DepartmentDraft = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  manager_id: string | null;
  parent_id: string | null;
  description: string | null;
  is_active: boolean;
};

export function DepartmentForm({
  department,
  managers,
  parents,
  companies,
}: {
  department?: DepartmentDraft;
  managers: { id: string; name: string }[];
  /** Candidate parents, already indented by depth and excluding descendants. */
  parents: { id: string; name: string }[];
  companies?: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const editing = department != null;
  const needsCompany = !editing && companies != null;

  const fields: FieldSpec[] = [
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: department.id }] as FieldSpec[]) : []),
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
    { kind: 'text', name: 'code', label: t.common.code, defaultValue: department?.code, required: true, dir: 'ltr', placeholder: 'OPS' },
    {
      kind: 'select',
      name: 'manager_id',
      label: t.users.manager,
      defaultValue: department?.manager_id,
      options: managers.map((manager) => ({ value: manager.id, label: manager.name })),
    },
    {
      kind: 'select',
      name: 'parent_id',
      label: t.org.parentDepartment,
      defaultValue: department?.parent_id,
      placeholder: t.org.mainDepartment,
      hint: t.org.parentHint,
      full: true,
      options: parents.map((parent) => ({ value: parent.id, label: parent.name })),
    },
    { kind: 'text', name: 'name_ar', label: t.companies.nameAr, defaultValue: department?.name_ar, required: true },
    { kind: 'text', name: 'name_en', label: t.companies.nameEn, defaultValue: department?.name_en, required: true, dir: 'ltr' },
    { kind: 'textarea', name: 'description', label: t.common.description, defaultValue: department?.description },
    {
      kind: 'checkbox',
      name: 'is_active',
      label: t.common.active,
      defaultChecked: department?.is_active ?? true,
      full: true,
    },
  ];

  return (
    <EntityForm
      action={editing ? updateDepartment : createDepartment}
      title={editing ? t.org.editDepartment : t.org.createDepartment}
      fields={fields}
      trigger={editing ? t.common.edit : t.org.createDepartment}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
    />
  );
}
