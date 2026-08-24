'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { Notice } from '@/components/ui';
import {
  addOrderNote,
  assignOrder,
  cancelOrder,
  logCall,
  releaseOrder,
  saveOrderItem,
  sendMessage,
} from '../actions';

/** The dialogs of the §4.5 order workspace. */

export type Option = { id: string; name: string };

const CALL_OUTCOMES = [
  'confirmed', 'cancelled', 'no_answer', 'busy', 'switched_off', 'wrong_number',
  'invalid_number', 'callback_requested', 'postponed', 'voicemail',
] as const;

/* -------------------------------------------------------------------------- */
/* Order lines — §4.7 "تعديل المنتجات"                                         */
/* -------------------------------------------------------------------------- */

export type ItemDraft = {
  id: string;
  variant_id: string | null;
  sku: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  discount: number;
  tax: number;
  notes: string | null;
};

export function ItemForm({
  orderId,
  variants,
  item,
  locked,
}: {
  orderId: string;
  variants: Option[];
  item?: ItemDraft;
  locked?: boolean;
}) {
  const { t } = useI18n();
  const editing = item != null;

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'order_id', value: orderId },
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: item.id }] as FieldSpec[]) : []),

    {
      kind: 'select',
      name: 'variant_id',
      label: t.products.variants,
      defaultValue: item?.variant_id,
      options: variants.map((v) => ({ value: v.id, label: v.name })),
      full: true,
      // §3.13 rule 13 — an order can legitimately arrive for a product that is
      // not in the catalog yet, so a free-text line stays possible.
      hint: 'Leave empty for a product that is not in the catalog yet.',
    },
    { kind: 'text', name: 'name', label: t.common.name, defaultValue: item?.name, required: true, full: true },
    { kind: 'text', name: 'sku', label: t.products.sku, defaultValue: item?.sku, dir: 'ltr' },
    { kind: 'text', name: 'quantity', label: t.orders.quantity, type: 'number', step: '0.001', min: 0, defaultValue: item?.quantity ?? 1, required: true },
    { kind: 'text', name: 'unit_price', label: t.orders.unitPrice, type: 'number', step: '0.01', min: 0, defaultValue: item?.unit_price, required: true },
    { kind: 'text', name: 'discount', label: t.orders.discount, type: 'number', step: '0.01', min: 0, defaultValue: item?.discount ?? 0 },
    { kind: 'text', name: 'tax', label: t.orders.tax, type: 'number', step: '0.01', min: 0, defaultValue: item?.tax ?? 0 },
    { kind: 'textarea', name: 'notes', label: t.common.notes, defaultValue: item?.notes, rows: 2 },
  ];

  return (
    <EntityForm
      action={saveOrderItem}
      title={editing ? t.orders.editItem : t.orders.addItem}
      description={t.orders.itemsSubtitle}
      fields={fields}
      trigger={editing ? t.common.edit : t.orders.addItem}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'secondary'}
      triggerSize="sm"
      submitLabel={editing ? t.common.saveChanges : t.common.add}
      size="lg"
      banner={locked ? <Notice tone="warning">{t.orders.warehouseLocked}</Notice> : undefined}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Calls — §4.10                                                              */
/* -------------------------------------------------------------------------- */

export function CallForm({
  orderId,
  phone,
  attempt,
}: {
  orderId: string;
  phone: string;
  attempt: number;
}) {
  const { t } = useI18n();

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'order_id', value: orderId },
    { kind: 'text', name: 'phone', label: t.orders.phone, defaultValue: phone, required: true, dir: 'ltr' },
    {
      kind: 'select',
      name: 'outcome',
      label: t.orders.outcome,
      required: true,
      options: CALL_OUTCOMES.map((value) => ({ value, label: t.callOutcome[value] })),
    },
    { kind: 'text', name: 'duration_seconds', label: `${t.orders.duration} (s)`, type: 'number', min: 0 },
    {
      kind: 'text',
      name: 'callback_at',
      label: t.orders.callbackAt,
      type: 'date',
      hint: 'Required when the outcome is a callback request.',
    },
    { kind: 'text', name: 'recording_url', label: t.orders.recording, dir: 'ltr', full: true },
    { kind: 'textarea', name: 'notes', label: t.common.notes, rows: 2 },
  ];

  return (
    <EntityForm
      action={logCall}
      title={`${t.orders.logCall} — ${t.orders.attempt} ${attempt + 1}`}
      description={t.orders.callsSubtitle}
      fields={fields}
      trigger={t.orders.logCall}
      triggerVariant="secondary"
      triggerSize="sm"
      submitLabel={t.common.save}
      size="lg"
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Messages — §4.9                                                            */
/* -------------------------------------------------------------------------- */

export function MessageForm({
  orderId,
  templates,
  language,
}: {
  orderId: string;
  templates: { code: string; name: string }[];
  language: string;
}) {
  const { t } = useI18n();

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'order_id', value: orderId },
    {
      kind: 'select',
      name: 'template_code',
      label: t.orders.template,
      options: templates.map((template) => ({ value: template.code, label: template.name })),
      full: true,
      hint: 'Placeholders are filled from the order when the message is queued.',
    },
    {
      kind: 'select',
      name: 'language',
      label: t.common.language,
      defaultValue: language === 'en' ? 'en' : 'ar',
      required: true,
      options: [
        { value: 'ar', label: 'العربية' },
        { value: 'en', label: 'English' },
      ],
    },
    { kind: 'text', name: 'payment_link', label: t.orders.messageBody + ' — {payment_link}', dir: 'ltr' },
    {
      kind: 'textarea',
      name: 'body',
      label: t.orders.messageBody,
      rows: 3,
      hint: 'Leave empty to use the template text as-is.',
    },
  ];

  return (
    <EntityForm
      action={sendMessage}
      title={t.orders.sendMessage}
      description={t.orders.messagesSubtitle}
      fields={fields}
      trigger={t.orders.sendMessage}
      triggerVariant="secondary"
      triggerSize="sm"
      submitLabel={t.common.save}
      size="lg"
      banner={
        <Notice tone="info">
          No WhatsApp provider is connected yet, so the message is recorded and queued rather than
          transmitted. Connecting a provider later sends the queue without changing this screen.
        </Notice>
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Cancellation — §4.11 / §4.15 rule 8                                        */
/* -------------------------------------------------------------------------- */

export function CancelForm({
  orderId,
  reasons,
}: {
  orderId: string;
  reasons: { id: string; name: string; requiresNote: boolean }[];
}) {
  const { t } = useI18n();

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'id', value: orderId },
    {
      kind: 'select',
      name: 'cancellation_reason_id',
      label: t.orders.cancellationReason,
      required: true,
      full: true,
      options: reasons.map((reason) => ({
        value: reason.id,
        label: reason.requiresNote ? `${reason.name} *` : reason.name,
      })),
    },
    {
      kind: 'textarea',
      name: 'cancellation_note',
      label: t.orders.cancellationNote,
      rows: 3,
      hint: 'Reasons marked * require a note.',
    },
  ];

  return (
    <EntityForm
      action={cancelOrder}
      title={t.orders.cancel}
      fields={fields}
      trigger={t.orders.cancel}
      triggerIcon="none"
      triggerVariant="secondary"
      triggerSize="sm"
      submitLabel={t.orders.cancel}
      banner={<Notice tone="warning">{t.orders.cancelNeedsReason}</Notice>}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Assignment — §4.6                                                          */
/* -------------------------------------------------------------------------- */

export function AssignForm({ orderId, agents }: { orderId: string; agents: Option[] }) {
  const { t } = useI18n();

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'id', value: orderId },
    {
      kind: 'select',
      name: 'assigned_to',
      label: t.orders.assignedTo,
      full: true,
      options: agents.map((agent) => ({ value: agent.id, label: agent.name })),
    },
    {
      kind: 'checkbox',
      name: 'auto',
      label: t.orders.autoAssign,
      hint: 'Round robin: the eligible agent with the lightest open load (§4.6).',
      full: true,
    },
  ];

  return (
    <EntityForm
      action={assignOrder}
      title={t.orders.assign}
      fields={fields}
      trigger={t.orders.assign}
      triggerIcon="none"
      triggerVariant="secondary"
      triggerSize="sm"
      submitLabel={t.orders.assign}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Warehouse handover — §4.3 stage 4                                          */
/* -------------------------------------------------------------------------- */

export function ReleaseForm({
  orderId,
  warehouses,
  confirmed,
}: {
  orderId: string;
  warehouses: Option[];
  confirmed: boolean;
}) {
  const { t } = useI18n();

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'id', value: orderId },
    {
      kind: 'select',
      name: 'warehouse_id',
      label: t.nav.warehouses,
      full: true,
      options: warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name })),
    },
  ];

  return (
    <EntityForm
      action={releaseOrder}
      title={t.orders.release}
      fields={fields}
      trigger={t.orders.release}
      triggerIcon="none"
      triggerVariant="primary"
      triggerSize="sm"
      submitLabel={t.orders.release}
      banner={confirmed ? undefined : <Notice tone="warning">{t.orders.releaseBlocked}</Notice>}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Notes — §4.7                                                               */
/* -------------------------------------------------------------------------- */

export function NoteForm({ orderId }: { orderId: string }) {
  const { t } = useI18n();

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'order_id', value: orderId },
    { kind: 'textarea', name: 'summary', label: t.orders.note, required: true, rows: 3 },
  ];

  return (
    <EntityForm
      action={addOrderNote}
      title={t.orders.addNote}
      fields={fields}
      trigger={t.orders.addNote}
      triggerVariant="ghost"
      triggerSize="sm"
      submitLabel={t.common.add}
    />
  );
}
