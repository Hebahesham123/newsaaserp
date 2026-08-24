'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import {
  saveBlacklistEntry,
  saveCancellationReason,
  saveCustomer,
  saveMessageTemplate,
} from './settings-actions';

/** Forms for the configurable data behind the Confirmation Center. */

export type Option = { id: string; name: string };

/** A platform admin has no implicit company, so create forms have to ask. */
function companyField(t: ReturnType<typeof useI18n>['t'], companies?: Option[]): FieldSpec[] {
  if (!companies) return [];
  return [
    {
      kind: 'select',
      name: 'company_id',
      label: t.merchants.company,
      placeholder: t.merchants.selectCompany,
      required: true,
      full: true,
      options: companies.map((company) => ({ value: company.id, label: company.name })),
    },
  ];
}

const idField = (id?: string): FieldSpec[] => (id ? [{ kind: 'hidden', name: 'id', value: id }] : []);

/* -------------------------------------------------------------------------- */
/* Cancellation reasons — §4.11                                               */
/* -------------------------------------------------------------------------- */

export type ReasonDraft = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  is_customer_fault: boolean;
  requires_note: boolean;
  sort_order: number;
  is_active: boolean;
};

export function ReasonForm({ reason, companies }: { reason?: ReasonDraft; companies?: Option[] }) {
  const { t } = useI18n();
  const editing = reason != null;

  const fields: FieldSpec[] = [
    ...idField(reason?.id),
    ...(editing ? [] : companyField(t, companies)),
    { kind: 'text', name: 'code', label: t.common.code, defaultValue: reason?.code, required: true, dir: 'ltr' },
    { kind: 'text', name: 'sort_order', label: t.catalog.sortOrder, type: 'number', defaultValue: reason?.sort_order ?? 0 },
    { kind: 'text', name: 'name_en', label: t.companies.nameEn, defaultValue: reason?.name_en, required: true },
    { kind: 'text', name: 'name_ar', label: t.companies.nameAr, defaultValue: reason?.name_ar, required: true, dir: 'rtl' },
    {
      kind: 'checkbox',
      name: 'is_customer_fault',
      label: t.cancellationReasons.customerFault,
      defaultChecked: reason?.is_customer_fault ?? false,
      hint: 'Separates "customer refused" from "we could not reach them" in the §4.16 report.',
    },
    {
      kind: 'checkbox',
      name: 'requires_note',
      label: t.cancellationReasons.requiresNote,
      defaultChecked: reason?.requires_note ?? false,
    },
    { kind: 'checkbox', name: 'is_active', label: t.common.active, defaultChecked: reason?.is_active ?? true },
  ];

  return (
    <EntityForm
      action={saveCancellationReason}
      title={editing ? t.cancellationReasons.editTitle : t.cancellationReasons.createTitle}
      fields={fields}
      trigger={editing ? t.common.edit : t.cancellationReasons.createTitle}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Blacklist — §4.13                                                          */
/* -------------------------------------------------------------------------- */

export type BlacklistDraft = {
  id: string;
  scope: string;
  value: string;
  reason: string;
  expires_at: string | null;
  is_active: boolean;
};

export function BlacklistForm({
  entry,
  companies,
}: {
  entry?: BlacklistDraft;
  companies?: Option[];
}) {
  const { t } = useI18n();
  const editing = entry != null;

  const fields: FieldSpec[] = [
    ...idField(entry?.id),
    ...(editing ? [] : companyField(t, companies)),
    {
      kind: 'select',
      name: 'scope',
      label: t.blacklist.scope,
      defaultValue: entry?.scope ?? 'phone',
      required: true,
      options: [
        { value: 'phone', label: t.orders.phone },
        { value: 'address', label: t.orders.address },
        { value: 'email', label: t.common.email },
      ],
    },
    { kind: 'text', name: 'value', label: t.blacklist.value, defaultValue: entry?.value, required: true, dir: 'ltr' },
    { kind: 'textarea', name: 'reason', label: t.blacklist.reason, defaultValue: entry?.reason, required: true, rows: 2 },
    {
      kind: 'text',
      name: 'expires_at',
      label: t.blacklist.expiresAt,
      type: 'date',
      defaultValue: entry?.expires_at?.slice(0, 10),
      hint: 'Leave empty for a permanent block.',
    },
    { kind: 'checkbox', name: 'is_active', label: t.common.active, defaultChecked: entry?.is_active ?? true },
  ];

  return (
    <EntityForm
      action={saveBlacklistEntry}
      title={editing ? t.blacklist.editTitle : t.blacklist.createTitle}
      fields={fields}
      trigger={editing ? t.common.edit : t.blacklist.createTitle}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Message templates — §4.9                                                   */
/* -------------------------------------------------------------------------- */

export type TemplateDraft = {
  id: string;
  code: string;
  name: string;
  channel: string;
  body_ar: string;
  body_en: string;
  variables: string[];
  sort_order: number;
  is_active: boolean;
};

export function TemplateForm({
  template,
  companies,
}: {
  template?: TemplateDraft;
  companies?: Option[];
}) {
  const { t } = useI18n();
  const editing = template != null;

  const fields: FieldSpec[] = [
    ...idField(template?.id),
    ...(editing ? [] : companyField(t, companies)),
    { kind: 'text', name: 'code', label: t.common.code, defaultValue: template?.code, required: true, dir: 'ltr' },
    { kind: 'text', name: 'name', label: t.common.name, defaultValue: template?.name, required: true },
    {
      kind: 'select',
      name: 'channel',
      label: t.orders.channel,
      defaultValue: template?.channel ?? 'whatsapp',
      required: true,
      options: [
        { value: 'whatsapp', label: 'WhatsApp' },
        { value: 'sms', label: 'SMS' },
        { value: 'email', label: t.common.email },
      ],
    },
    { kind: 'text', name: 'sort_order', label: t.catalog.sortOrder, type: 'number', defaultValue: template?.sort_order ?? 0 },
    { kind: 'textarea', name: 'body_ar', label: t.messageTemplates.bodyAr, defaultValue: template?.body_ar, required: true, rows: 3 },
    { kind: 'textarea', name: 'body_en', label: t.messageTemplates.bodyEn, defaultValue: template?.body_en, required: true, rows: 3 },
    {
      kind: 'text',
      name: 'variables',
      label: t.messageTemplates.variables,
      defaultValue: template?.variables.join(', '),
      hint: t.messageTemplates.variablesHint,
      full: true,
    },
    { kind: 'checkbox', name: 'is_active', label: t.common.active, defaultChecked: template?.is_active ?? true },
  ];

  return (
    <EntityForm
      action={saveMessageTemplate}
      title={editing ? t.messageTemplates.editTitle : t.messageTemplates.createTitle}
      fields={fields}
      trigger={editing ? t.common.edit : t.messageTemplates.createTitle}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
      size="lg"
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Customers — §4.8                                                           */
/* -------------------------------------------------------------------------- */

export type CustomerDraft = {
  id: string;
  name: string;
  phone: string;
  alt_phone: string | null;
  email: string | null;
  governorate: string | null;
  city: string | null;
  address: string | null;
  preferred_language: string;
  notes: string | null;
};

export function CustomerForm({
  customer,
  companies,
}: {
  customer?: CustomerDraft;
  companies?: Option[];
}) {
  const { t } = useI18n();
  const editing = customer != null;

  const fields: FieldSpec[] = [
    ...idField(customer?.id),
    ...(editing ? [] : companyField(t, companies)),
    { kind: 'text', name: 'name', label: t.orders.customerName, defaultValue: customer?.name, required: true },
    {
      kind: 'text',
      name: 'phone',
      label: t.orders.phone,
      type: 'tel',
      defaultValue: customer?.phone,
      required: true,
      dir: 'ltr',
      hint: 'The customer identity — one record per number per company (§4.8).',
    },
    { kind: 'text', name: 'alt_phone', label: t.orders.altPhone, type: 'tel', defaultValue: customer?.alt_phone, dir: 'ltr' },
    { kind: 'text', name: 'email', label: t.common.email, type: 'email', defaultValue: customer?.email, dir: 'ltr' },
    { kind: 'text', name: 'governorate', label: t.orders.governorate, defaultValue: customer?.governorate },
    { kind: 'text', name: 'city', label: t.orders.city, defaultValue: customer?.city },
    { kind: 'textarea', name: 'address', label: t.orders.address, defaultValue: customer?.address, rows: 2 },
    {
      kind: 'select',
      name: 'preferred_language',
      label: t.customers.preferredLanguage,
      defaultValue: customer?.preferred_language ?? 'ar',
      required: true,
      options: [
        { value: 'ar', label: 'العربية' },
        { value: 'en', label: 'English' },
      ],
    },
    { kind: 'textarea', name: 'notes', label: t.common.notes, defaultValue: customer?.notes, rows: 2 },
  ];

  return (
    <EntityForm
      action={saveCustomer}
      title={editing ? t.customers.editTitle : t.customers.title}
      fields={fields}
      trigger={editing ? t.common.edit : t.common.create}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
      size="lg"
    />
  );
}
