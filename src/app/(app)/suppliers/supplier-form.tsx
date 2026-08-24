'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { saveSupplier } from '../catalog/actions';

/** §3.6 suppliers — sources of purchased stock, with lead times and terms. */

export type Option = { id: string; name: string };

export type SupplierDraft = {
  id: string;
  code: string;
  name: string;
  merchant_id: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  address: string | null;
  payment_terms: string | null;
  lead_time_days: number | null;
  notes: string | null;
  is_active: boolean;
};

export function SupplierForm({
  supplier,
  merchants,
  companies,
}: {
  supplier?: SupplierDraft;
  merchants: Option[];
  /** Only supplied for platform admins, who have no implicit company. */
  companies?: Option[];
}) {
  const { t } = useI18n();
  const editing = supplier != null;

  const fields: FieldSpec[] = [
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: supplier.id }] as FieldSpec[]) : []),

    ...(!editing && companies
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

    { kind: 'text', name: 'code', label: t.common.code, defaultValue: supplier?.code, required: true, dir: 'ltr' },
    { kind: 'text', name: 'name', label: t.common.name, defaultValue: supplier?.name, required: true },
    {
      kind: 'select',
      name: 'merchant_id',
      label: t.stores.merchant,
      defaultValue: supplier?.merchant_id,
      options: merchants.map((m) => ({ value: m.id, label: m.name })),
      hint: 'Leave empty to share the supplier across the company.',
    },

    { kind: 'section', label: t.companies.contact },
    { kind: 'text', name: 'contact_person', label: t.merchants.contactPerson, defaultValue: supplier?.contact_person },
    { kind: 'text', name: 'email', label: t.common.email, type: 'email', defaultValue: supplier?.email, dir: 'ltr' },
    { kind: 'text', name: 'phone', label: t.common.phone, type: 'tel', defaultValue: supplier?.phone, dir: 'ltr' },
    { kind: 'text', name: 'country', label: t.common.country, defaultValue: supplier?.country },
    { kind: 'text', name: 'address', label: t.common.address, defaultValue: supplier?.address, full: true },

    { kind: 'section', label: t.merchants.commercialTerms },
    { kind: 'text', name: 'payment_terms', label: t.suppliers.paymentTerms, defaultValue: supplier?.payment_terms, placeholder: 'Net 30' },
    { kind: 'text', name: 'lead_time_days', label: t.suppliers.leadTime, type: 'number', min: 0, defaultValue: supplier?.lead_time_days },

    { kind: 'textarea', name: 'notes', label: t.common.notes, defaultValue: supplier?.notes, rows: 2 },
    { kind: 'checkbox', name: 'is_active', label: t.common.active, defaultChecked: supplier?.is_active ?? true },
  ];

  return (
    <EntityForm
      action={saveSupplier}
      title={editing ? t.suppliers.editTitle : t.suppliers.createTitle}
      description={editing ? supplier.name : undefined}
      fields={fields}
      trigger={editing ? t.common.edit : t.suppliers.createTitle}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
      size="lg"
    />
  );
}
