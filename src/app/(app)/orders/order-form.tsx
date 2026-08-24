'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { Notice } from '@/components/ui';
import { createOrder, updateOrder } from './actions';

/** §4.4 the order master form, used for manual intake and for §4.7 corrections. */

export type Option = { id: string; name: string };

export type OrderDraft = {
  id: string;
  merchant_id: string;
  store_id: string | null;
  source: string;
  external_order_number: string | null;
  customer_name: string;
  customer_phone: string;
  customer_alt_phone: string | null;
  customer_email: string | null;
  governorate: string | null;
  city: string | null;
  address: string | null;
  address_notes: string | null;
  maps_url: string | null;
  payment_method: string;
  payment_status: string;
  currency: string;
  shipping_fees: number;
  notes: string | null;
  internal_notes: string | null;
};

const ORDER_SOURCES = [
  'shopify', 'woocommerce', 'amazon', 'noon', 'custom_api', 'mobile_app',
  'pos', 'excel_import', 'manual', 'social_commerce', 'whatsapp', 'call_center',
] as const;

const PAYMENT_METHODS = [
  'cod', 'card', 'wallet', 'bank_transfer', 'payment_link', 'installment', 'other',
] as const;

const PAYMENT_STATUSES = [
  'pending', 'authorized', 'paid', 'partially_paid', 'refunded', 'voided', 'failed',
] as const;

export function OrderForm({
  order,
  merchants,
  stores,
  locked,
}: {
  order?: OrderDraft;
  merchants: Option[];
  stores: Option[];
  /** §4.15 rule 5 — the order is already with the warehouse. */
  locked?: boolean;
}) {
  const { t } = useI18n();
  const editing = order != null;

  const fields: FieldSpec[] = [
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: order.id }] as FieldSpec[]) : []),

    { kind: 'section', label: t.orders.title },
    // The merchant fixes the tenant, so it is chosen once and then carried on
    // the row; editing keeps it as a hidden field rather than inviting a move.
    editing
      ? { kind: 'hidden', name: 'merchant_id', value: order.merchant_id }
      : {
          kind: 'select',
          name: 'merchant_id',
          label: t.stores.merchant,
          required: true,
          options: merchants.map((m) => ({ value: m.id, label: m.name })),
        },
    {
      kind: 'select',
      name: 'store_id',
      label: t.nav.stores,
      defaultValue: order?.store_id,
      options: stores.map((s) => ({ value: s.id, label: s.name })),
    },
    {
      kind: 'select',
      name: 'source',
      label: t.orders.source,
      defaultValue: order?.source ?? 'manual',
      required: true,
      options: ORDER_SOURCES.map((value) => ({ value, label: t.orderSource[value] })),
    },
    {
      kind: 'text',
      name: 'external_order_number',
      label: t.orders.externalNumber,
      defaultValue: order?.external_order_number,
      dir: 'ltr',
    },

    { kind: 'section', label: t.orders.customer },
    { kind: 'text', name: 'customer_name', label: t.orders.customerName, defaultValue: order?.customer_name, required: true },
    { kind: 'text', name: 'customer_phone', label: t.orders.phone, type: 'tel', defaultValue: order?.customer_phone, required: true, dir: 'ltr' },
    { kind: 'text', name: 'customer_alt_phone', label: t.orders.altPhone, type: 'tel', defaultValue: order?.customer_alt_phone, dir: 'ltr' },
    { kind: 'text', name: 'customer_email', label: t.common.email, type: 'email', defaultValue: order?.customer_email, dir: 'ltr' },

    { kind: 'section', label: t.orders.address },
    { kind: 'text', name: 'governorate', label: t.orders.governorate, defaultValue: order?.governorate },
    { kind: 'text', name: 'city', label: t.orders.city, defaultValue: order?.city },
    { kind: 'textarea', name: 'address', label: t.orders.address, defaultValue: order?.address, rows: 2 },
    { kind: 'text', name: 'address_notes', label: t.orders.addressNotes, defaultValue: order?.address_notes, full: true },
    { kind: 'text', name: 'maps_url', label: t.orders.mapsLocation, defaultValue: order?.maps_url, dir: 'ltr', full: true },

    { kind: 'section', label: t.orders.paymentMethod },
    {
      kind: 'select',
      name: 'payment_method',
      label: t.orders.paymentMethod,
      defaultValue: order?.payment_method ?? 'cod',
      required: true,
      options: PAYMENT_METHODS.map((value) => ({ value, label: t.paymentMethod[value] })),
    },
    {
      kind: 'select',
      name: 'payment_status',
      label: t.orders.paymentStatus,
      defaultValue: order?.payment_status ?? 'pending',
      required: true,
      options: PAYMENT_STATUSES.map((value) => ({ value, label: t.paymentStatus[value] })),
    },
    { kind: 'text', name: 'currency', label: t.common.currency, defaultValue: order?.currency ?? 'EGP', required: true, dir: 'ltr' },
    {
      kind: 'text',
      name: 'shipping_fees',
      label: t.orders.shippingFees,
      type: 'number',
      step: '0.01',
      min: 0,
      defaultValue: order?.shipping_fees ?? 0,
      hint: 'Changing this re-totals the order.',
    },

    { kind: 'textarea', name: 'notes', label: t.orders.customerNotes, defaultValue: order?.notes, rows: 2 },
    { kind: 'textarea', name: 'internal_notes', label: t.orders.internalNotes, defaultValue: order?.internal_notes, rows: 2 },
  ];

  return (
    <EntityForm
      action={editing ? updateOrder : createOrder}
      title={editing ? t.orders.editTitle : t.orders.createTitle}
      description={editing ? order.customer_name : undefined}
      fields={fields}
      trigger={editing ? t.common.edit : t.orders.createTitle}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
      size="xl"
      banner={locked ? <Notice tone="warning">{t.orders.warehouseLocked}</Notice> : undefined}
    />
  );
}
