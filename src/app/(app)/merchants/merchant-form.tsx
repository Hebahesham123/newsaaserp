'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { Notice } from '@/components/ui';
import { createMerchant, updateMerchant } from './actions';

export type MerchantDraft = {
  id: string;
  code: string;
  name: string;
  trade_name: string | null;
  merchant_type: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  address: string | null;
  tax_registration_number: string | null;
  commercial_registration_number: string | null;
  currency: string;
  status: string;
  operating_model: string;
  contract_date: string | null;
  go_live_date: string | null;
  credit_limit: number | null;
  payment_terms: string | null;
  settlement_cycle: string | null;
  commission_percentage: number | null;
  services: string[];
  internal_notes: string | null;
};

const STATUSES = [
  'lead', 'contracting', 'onboarding', 'ready_for_go_live', 'active',
  'temporarily_suspended', 'payment_overdue', 'on_hold', 'contract_terminated', 'archived',
] as const;

const MODELS = [
  'ecommerce_store_management', 'fulfillment', 'operations_only',
] as const;

const SERVICES = [
  'order_management', 'order_confirmation', 'customer_service', 'warehousing',
  'goods_receiving', 'picking_packing', 'shipping', 'shipment_followup',
  'return_management', 'collection_management', 'marketplace_management',
  'product_management', 'inventory_management', 'affiliate_management',
  'reporting_only', 'full_operations',
] as const;

export function MerchantForm({
  merchant,
  companies,
}: {
  merchant?: MerchantDraft;
  /** Only supplied for platform admins, who have no implicit company. */
  companies?: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const editing = merchant != null;
  const needsCompany = !editing && companies != null;

  const fields: FieldSpec[] = [
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: merchant.id }] as FieldSpec[]) : []),

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

    { kind: 'section', label: t.companies.identity },
    { kind: 'text', name: 'code', label: t.common.code, defaultValue: merchant?.code, required: true, dir: 'ltr', placeholder: 'NRA' },
    { kind: 'text', name: 'name', label: t.common.name, defaultValue: merchant?.name, required: true },
    { kind: 'text', name: 'trade_name', label: t.companies.tradeName, defaultValue: merchant?.trade_name },
    { kind: 'text', name: 'merchant_type', label: t.merchants.merchantType, defaultValue: merchant?.merchant_type },
    {
      kind: 'select',
      name: 'operating_model',
      label: t.companies.operatingModel,
      defaultValue: merchant?.operating_model ?? 'ecommerce_store_management',
      required: true,
      options: MODELS.map((model) => ({ value: model, label: t.operatingModel[model] })),
    },
    {
      kind: 'select',
      name: 'status',
      label: t.common.status,
      defaultValue: merchant?.status ?? 'lead',
      required: true,
      options: STATUSES.map((status) => ({ value: status, label: t.status[status] })),
    },

    { kind: 'section', label: t.companies.contact },
    { kind: 'text', name: 'contact_person', label: t.merchants.contactPerson, defaultValue: merchant?.contact_person },
    { kind: 'text', name: 'email', label: t.common.email, type: 'email', defaultValue: merchant?.email, dir: 'ltr' },
    { kind: 'text', name: 'phone', label: t.common.phone, type: 'tel', defaultValue: merchant?.phone, dir: 'ltr' },
    { kind: 'text', name: 'country', label: t.common.country, defaultValue: merchant?.country },
    { kind: 'text', name: 'address', label: t.common.address, defaultValue: merchant?.address, full: true },
    { kind: 'text', name: 'tax_registration_number', label: t.companies.taxNumber, defaultValue: merchant?.tax_registration_number, dir: 'ltr' },
    { kind: 'text', name: 'commercial_registration_number', label: t.companies.commercialRegistration, defaultValue: merchant?.commercial_registration_number, dir: 'ltr' },

    { kind: 'section', label: t.merchants.services },
    {
      kind: 'multi',
      name: 'services',
      label: t.merchants.services,
      selected: merchant?.services ?? [],
      options: SERVICES.map((service) => ({ value: service, label: t.merchantService[service] })),
      columns: 2,
      full: true,
    },

    { kind: 'section', label: t.merchants.commercialTerms },
    { kind: 'text', name: 'currency', label: t.common.currency, defaultValue: merchant?.currency ?? 'EGP', required: true, dir: 'ltr' },
    { kind: 'text', name: 'settlement_cycle', label: t.merchants.settlementCycle, defaultValue: merchant?.settlement_cycle, placeholder: 'weekly' },
    { kind: 'text', name: 'payment_terms', label: t.merchants.paymentTerms, defaultValue: merchant?.payment_terms, placeholder: 'Net 30' },
    { kind: 'text', name: 'commission_percentage', label: t.merchants.commission, type: 'number', step: '0.001', min: 0, max: 100, defaultValue: merchant?.commission_percentage },
    { kind: 'text', name: 'credit_limit', label: t.merchants.creditLimit, type: 'number', step: '0.01', min: 0, defaultValue: merchant?.credit_limit },
    { kind: 'text', name: 'contract_date', label: t.merchants.contractDate, type: 'date', defaultValue: merchant?.contract_date },
    { kind: 'text', name: 'go_live_date', label: t.merchants.goLiveDate, type: 'date', defaultValue: merchant?.go_live_date },

    { kind: 'textarea', name: 'internal_notes', label: t.common.internalNotes, defaultValue: merchant?.internal_notes },
  ];

  return (
    <EntityForm
      action={editing ? updateMerchant : createMerchant}
      title={editing ? t.merchants.editTitle : t.merchants.createTitle}
      description={editing ? merchant.name : undefined}
      fields={fields}
      trigger={editing ? t.common.edit : t.merchants.createTitle}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
      size="lg"
      banner={needsCompany ? <Notice tone="info">{t.merchants.noCompanyHint}</Notice> : undefined}
    />
  );
}
