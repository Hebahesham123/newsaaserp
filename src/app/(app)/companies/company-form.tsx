'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { createCompany, updateCompany } from './actions';

export type CompanyDraft = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  trade_name: string | null;
  business_type: string | null;
  country: string | null;
  region: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  tax_registration_number: string | null;
  commercial_registration_number: string | null;
  base_currency: string;
  timezone: string;
  default_locale: string;
  status: string;
  operating_model: string;
  subscription_plan: string | null;
  subscription_start_date: string | null;
  subscription_end_date: string | null;
  max_users: number | null;
  max_stores: number | null;
  max_monthly_orders: number | null;
  internal_notes: string | null;
};

const STATUSES = [
  'draft', 'under_review', 'active', 'suspended',
  'temporarily_blocked', 'subscription_expired', 'cancelled', 'archived',
] as const;

const MODELS = [
  'own_store', 'multi_store', 'fulfillment_center', 'operations_only', 'marketplace',
] as const;

export function CompanyForm({ company }: { company?: CompanyDraft }) {
  const { t } = useI18n();
  const editing = company != null;

  const fields: FieldSpec[] = [
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: company.id }] as FieldSpec[]) : []),

    { kind: 'section', label: t.companies.identity },
    { kind: 'text', name: 'code', label: t.common.code, defaultValue: company?.code, required: true, dir: 'ltr', placeholder: 'GRN-EG' },
    { kind: 'text', name: 'trade_name', label: t.companies.tradeName, defaultValue: company?.trade_name },
    { kind: 'text', name: 'name_ar', label: t.companies.nameAr, defaultValue: company?.name_ar, required: true },
    { kind: 'text', name: 'name_en', label: t.companies.nameEn, defaultValue: company?.name_en, required: true, dir: 'ltr' },
    { kind: 'text', name: 'business_type', label: t.companies.businessType, defaultValue: company?.business_type },
    {
      kind: 'select',
      name: 'operating_model',
      label: t.companies.operatingModel,
      defaultValue: company?.operating_model ?? 'own_store',
      required: true,
      options: MODELS.map((model) => ({ value: model, label: t.operatingModel[model] })),
    },
    {
      kind: 'select',
      name: 'status',
      label: t.common.status,
      defaultValue: company?.status ?? 'draft',
      required: true,
      options: STATUSES.map((status) => ({ value: status, label: t.status[status] })),
    },

    { kind: 'section', label: t.companies.contact },
    { kind: 'text', name: 'email', label: t.common.email, type: 'email', defaultValue: company?.email, dir: 'ltr' },
    { kind: 'text', name: 'phone', label: t.common.phone, type: 'tel', defaultValue: company?.phone, dir: 'ltr' },
    { kind: 'text', name: 'website', label: t.common.website, defaultValue: company?.website, dir: 'ltr' },
    { kind: 'text', name: 'country', label: t.common.country, defaultValue: company?.country },
    { kind: 'text', name: 'region', label: t.common.region, defaultValue: company?.region },
    { kind: 'text', name: 'address', label: t.common.address, defaultValue: company?.address, full: true },
    { kind: 'text', name: 'tax_registration_number', label: t.companies.taxNumber, defaultValue: company?.tax_registration_number, dir: 'ltr' },
    { kind: 'text', name: 'commercial_registration_number', label: t.companies.commercialRegistration, defaultValue: company?.commercial_registration_number, dir: 'ltr' },

    { kind: 'section', label: t.companies.subscription },
    { kind: 'text', name: 'base_currency', label: t.companies.baseCurrency, defaultValue: company?.base_currency ?? 'EGP', required: true, dir: 'ltr' },
    {
      kind: 'select',
      name: 'default_locale',
      label: t.common.locale,
      defaultValue: company?.default_locale ?? 'ar',
      required: true,
      options: [
        { value: 'ar', label: 'العربية' },
        { value: 'en', label: 'English' },
      ],
    },
    { kind: 'text', name: 'timezone', label: t.common.timezone, defaultValue: company?.timezone ?? 'Africa/Cairo', dir: 'ltr' },
    { kind: 'text', name: 'subscription_plan', label: t.companies.subscriptionPlan, defaultValue: company?.subscription_plan },
    { kind: 'text', name: 'subscription_start_date', label: t.companies.subscriptionStarts, type: 'date', defaultValue: company?.subscription_start_date },
    { kind: 'text', name: 'subscription_end_date', label: t.companies.subscriptionEnds, type: 'date', defaultValue: company?.subscription_end_date },
    { kind: 'text', name: 'max_users', label: t.companies.maxUsers, type: 'number', min: 1, defaultValue: company?.max_users },
    { kind: 'text', name: 'max_stores', label: t.companies.maxStores, type: 'number', min: 1, defaultValue: company?.max_stores },
    { kind: 'text', name: 'max_monthly_orders', label: t.companies.maxMonthlyOrders, type: 'number', min: 1, defaultValue: company?.max_monthly_orders },

    { kind: 'textarea', name: 'internal_notes', label: t.common.internalNotes, defaultValue: company?.internal_notes },
  ];

  return (
    <EntityForm
      action={editing ? updateCompany : createCompany}
      title={editing ? t.companies.editTitle : t.companies.createTitle}
      description={editing ? company.name_en : t.companies.createHint}
      fields={fields}
      trigger={editing ? t.common.edit : t.companies.createTitle}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
      size="lg"
    />
  );
}
