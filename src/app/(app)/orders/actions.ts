'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  describeDbError,
  fieldErrorsFrom,
  nullIfBlank,
  numberOrNull,
  type ActionState,
} from '@/lib/forms';
import type { Session } from '@/lib/auth/session';

/**
 * §4 Orders & Confirmation Center.
 *
 * The lifecycle rules themselves (§4.15) live in database triggers, not here:
 * an order cannot reach the warehouse unconfirmed, cannot be cancelled without
 * a reason, and cannot be deleted, whichever code path is doing the writing.
 * These actions supply intent and let the database refuse what it must, then
 * surface the refusal verbatim.
 */

const ORDER_SOURCES = [
  'shopify', 'woocommerce', 'amazon', 'noon', 'custom_api', 'mobile_app',
  'pos', 'excel_import', 'manual', 'social_commerce', 'whatsapp', 'call_center',
] as const;

const ORDER_STATUSES = [
  'new', 'imported', 'pending_review',
  'duplicate_check', 'fraud_check', 'customer_history_review',
  'pending_assignment', 'assigned', 'first_call', 'second_call', 'third_call',
  'whatsapp_confirmation', 'callback', 'confirmed', 'cancelled',
  'ready_for_warehouse',
] as const;

const PAYMENT_METHODS = [
  'cod', 'card', 'wallet', 'bank_transfer', 'payment_link', 'installment', 'other',
] as const;

const PAYMENT_STATUSES = [
  'pending', 'authorized', 'paid', 'partially_paid', 'refunded', 'voided', 'failed',
] as const;

const CALL_OUTCOMES = [
  'confirmed', 'cancelled', 'no_answer', 'busy', 'switched_off', 'wrong_number',
  'invalid_number', 'callback_requested', 'postponed', 'voicemail',
] as const;

function revalidateOrder(orderId?: string) {
  revalidatePath('/orders');
  revalidatePath('/confirmation');
  revalidatePath('/duplicates');
  if (orderId) revalidatePath(`/orders/${orderId}`);
  revalidatePath('/');
}

/**
 * §4.8 the customer record is keyed on (company, phone). Orders arrive with no
 * account far more often than not, so the phone number is the identity: an
 * existing customer is reused and refreshed, a new one is created.
 */
async function upsertCustomer(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
  merchantId: string,
  details: { name: string; phone: string; email?: string | null; governorate?: string | null; city?: string | null; address?: string | null },
  session: Session,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('company_id', companyId)
    .eq('phone', details.phone)
    .maybeSingle();

  if (existing) {
    // Only fill blanks — a correction made on the customer record should not be
    // undone by an older order carrying stale details.
    await supabase
      .from('customers')
      .update({ updated_by: session.profile.id })
      .eq('id', existing.id);
    return existing.id;
  }

  const { data: created } = await supabase
    .from('customers')
    .insert({
      company_id: companyId,
      merchant_id: merchantId,
      name: details.name,
      phone: details.phone,
      email: details.email ?? null,
      governorate: details.governorate ?? null,
      city: details.city ?? null,
      address: details.address ?? null,
      created_by: session.profile.id,
    })
    .select('id')
    .single();

  return created?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/* Order master — §4.4                                                        */
/* -------------------------------------------------------------------------- */

const orderSchema = z.object({
  merchant_id: z.string().uuid('Select a merchant'),
  store_id: z.string().trim().optional(),
  source: z.enum(ORDER_SOURCES),
  external_order_number: z.string().trim().max(80).optional(),
  order_date: z.string().trim().optional(),

  customer_name: z.string().trim().min(2, 'Required').max(200),
  customer_phone: z.string().trim().min(6, 'A valid mobile number is required').max(40),
  customer_alt_phone: z.string().trim().max(40).optional(),
  customer_email: z.string().trim().email('Not a valid email').optional().or(z.literal('')),

  governorate: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  address: z.string().trim().max(600).optional(),
  address_notes: z.string().trim().max(400).optional(),
  maps_url: z.string().trim().max(600).optional(),

  payment_method: z.enum(PAYMENT_METHODS),
  payment_status: z.enum(PAYMENT_STATUSES),
  currency: z.string().trim().length(3, 'Three-letter code'),
  shipping_fees: z.string().trim().optional(),

  notes: z.string().trim().max(2000).optional(),
  internal_notes: z.string().trim().max(2000).optional(),
});

export async function createOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.create');

  const parsed = orderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();

  // The tenant comes from the merchant, never from the form (§2.13).
  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, company_id')
    .eq('id', parsed.data.merchant_id)
    .maybeSingle();

  if (!merchant) return { fieldErrors: { merchant_id: 'Merchant not found.' } };

  const customerId = await upsertCustomer(
    supabase,
    merchant.company_id,
    merchant.id,
    {
      name: parsed.data.customer_name,
      phone: parsed.data.customer_phone,
      email: nullIfBlank(parsed.data.customer_email),
      governorate: nullIfBlank(parsed.data.governorate),
      city: nullIfBlank(parsed.data.city),
      address: nullIfBlank(parsed.data.address),
    },
    session,
  );

  const { data, error } = await supabase
    .from('orders')
    .insert({
      company_id: merchant.company_id,
      merchant_id: merchant.id,
      store_id: nullIfBlank(parsed.data.store_id),
      customer_id: customerId,
      source: parsed.data.source,
      external_order_number: nullIfBlank(parsed.data.external_order_number),
      order_date: nullIfBlank(parsed.data.order_date) ?? new Date().toISOString(),
      status: 'pending_review',
      customer_name: parsed.data.customer_name,
      customer_phone: parsed.data.customer_phone,
      customer_alt_phone: nullIfBlank(parsed.data.customer_alt_phone),
      customer_email: nullIfBlank(parsed.data.customer_email),
      governorate: nullIfBlank(parsed.data.governorate),
      city: nullIfBlank(parsed.data.city),
      address: nullIfBlank(parsed.data.address),
      address_notes: nullIfBlank(parsed.data.address_notes),
      maps_url: nullIfBlank(parsed.data.maps_url),
      payment_method: parsed.data.payment_method,
      payment_status: parsed.data.payment_status,
      currency: parsed.data.currency.toUpperCase(),
      shipping_fees: numberOrNull(parsed.data.shipping_fees) ?? 0,
      notes: nullIfBlank(parsed.data.notes),
      internal_notes: nullIfBlank(parsed.data.internal_notes),
      created_by: session.profile.id,
    })
    .select('id')
    .single();

  if (error) return describeDbError(error);

  revalidateOrder(data.id);
  return { ok: true, message: 'Order created' };
}

/** §4.7 the confirmation agent may correct the customer, address and notes. */
export async function updateOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.edit');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing order id.' };

  const parsed = orderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('orders')
    .update({
      store_id: nullIfBlank(parsed.data.store_id),
      source: parsed.data.source,
      external_order_number: nullIfBlank(parsed.data.external_order_number),
      customer_name: parsed.data.customer_name,
      customer_phone: parsed.data.customer_phone,
      customer_alt_phone: nullIfBlank(parsed.data.customer_alt_phone),
      customer_email: nullIfBlank(parsed.data.customer_email),
      governorate: nullIfBlank(parsed.data.governorate),
      city: nullIfBlank(parsed.data.city),
      address: nullIfBlank(parsed.data.address),
      address_notes: nullIfBlank(parsed.data.address_notes),
      maps_url: nullIfBlank(parsed.data.maps_url),
      payment_method: parsed.data.payment_method,
      payment_status: parsed.data.payment_status,
      currency: parsed.data.currency.toUpperCase(),
      shipping_fees: numberOrNull(parsed.data.shipping_fees) ?? 0,
      notes: nullIfBlank(parsed.data.notes),
      internal_notes: nullIfBlank(parsed.data.internal_notes),
      updated_by: session.profile.id,
    })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidateOrder(id);
  return { ok: true, message: 'Order updated' };
}

/* -------------------------------------------------------------------------- */
/* Lifecycle transitions — §4.3, §4.7                                         */
/* -------------------------------------------------------------------------- */

export async function setOrderStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.edit');

  const id = String(formData.get('id') ?? '');
  const parsedStatus = z.enum(ORDER_STATUSES).safeParse(String(formData.get('status') ?? ''));
  if (!id) return { error: 'Missing order id.' };
  if (!parsedStatus.success) return { error: 'Unknown status.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('orders')
    .update({ status: parsedStatus.data, updated_by: session.profile.id })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidateOrder(id);
  return { ok: true, message: 'Status updated' };
}

export async function confirmOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.confirm');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing order id.' };

  const supabase = await createServerSupabase();

  // An order with no lines has nothing to fulfil, and the warehouse would
  // receive an empty pick list.
  const { count } = await supabase
    .from('order_items')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', id);

  if (!count) return { error: 'Add at least one product before confirming this order.' };

  const { error } = await supabase
    .from('orders')
    .update({
      status: 'confirmed',
      confirmed_by: session.profile.id,
      updated_by: session.profile.id,
    })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidateOrder(id);
  return { ok: true, message: 'Order confirmed' };
}

export async function cancelOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.cancel');

  const id = String(formData.get('id') ?? '');
  const reasonId = nullIfBlank(formData.get('cancellation_reason_id'));
  const note = nullIfBlank(formData.get('cancellation_note'));

  if (!id) return { error: 'Missing order id.' };

  // §4.15 rule 8 — the database refuses a reasonless cancellation too, but
  // saying so here keeps the message on the field the user has to fix.
  if (!reasonId) {
    return { fieldErrors: { cancellation_reason_id: 'A cancellation reason is required.' } };
  }

  const supabase = await createServerSupabase();

  const { data: reason } = await supabase
    .from('cancellation_reasons')
    .select('id, requires_note')
    .eq('id', reasonId)
    .maybeSingle();

  if (!reason) return { fieldErrors: { cancellation_reason_id: 'Reason not found.' } };
  if (reason.requires_note && !note) {
    return { fieldErrors: { cancellation_note: 'This reason requires a note.' } };
  }

  const { error } = await supabase
    .from('orders')
    .update({
      status: 'cancelled',
      cancellation_reason_id: reasonId,
      cancellation_note: note,
      cancelled_by: session.profile.id,
      updated_by: session.profile.id,
    })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidateOrder(id);
  return { ok: true, message: 'Order cancelled' };
}

/** §4.3 stage 4 — handover to the warehouse. */
export async function releaseOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.release');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing order id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('orders')
    .update({
      status: 'ready_for_warehouse',
      warehouse_id: nullIfBlank(formData.get('warehouse_id')),
      updated_by: session.profile.id,
    })
    .eq('id', id);

  // Rule 1 arrives as a check_violation carrying the spec reference; pass it
  // through rather than replacing it with something vaguer.
  if (error) return describeDbError(error);

  revalidateOrder(id);
  return { ok: true, message: 'Order sent to the warehouse' };
}

export async function archiveOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.archive');

  const id = String(formData.get('id') ?? '');
  const restore = formData.get('restore') != null;
  if (!id) return { error: 'Missing order id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('orders')
    .update({
      archived_at: restore ? null : new Date().toISOString(),
      archived_by: restore ? null : session.profile.id,
      updated_by: session.profile.id,
    })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidateOrder(id);
  return { ok: true, message: restore ? 'Order restored' : 'Order archived' };
}

/* -------------------------------------------------------------------------- */
/* Assignment — §4.6                                                          */
/* -------------------------------------------------------------------------- */

export async function assignOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.assign');

  const id = String(formData.get('id') ?? '');
  const requested = nullIfBlank(formData.get('assigned_to'));
  const auto = formData.get('auto') != null;
  if (!id) return { error: 'Missing order id.' };

  const supabase = await createServerSupabase();

  const { data: order } = await supabase
    .from('orders')
    .select('id, company_id')
    .eq('id', id)
    .maybeSingle();

  if (!order) return { error: 'Order not found.' };

  let assignee = requested;

  if (auto) {
    // §4.6 round robin. The rule lives in the database so "least loaded" is
    // answered against current state rather than a stale page render.
    const { data: next, error: rpcError } = await supabase.rpc('next_confirmation_agent', {
      p_company_id: order.company_id,
    });
    if (rpcError) return describeDbError(rpcError);
    assignee = next ?? null;
    if (!assignee) return { error: 'No active confirmation agent is available to take this order.' };
  }

  if (!assignee) return { fieldErrors: { assigned_to: 'Select an agent.' } };

  const { error } = await supabase
    .from('orders')
    .update({
      assigned_to: assignee,
      assigned_at: new Date().toISOString(),
      assigned_by: session.profile.id,
      assignment_method: auto ? 'round_robin' : assignee === session.profile.id ? 'self' : 'manual',
      status: 'assigned',
      updated_by: session.profile.id,
    })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidateOrder(id);
  return { ok: true, message: 'Order assigned' };
}

/** §4.6 an agent taking work from the unassigned pool. */
export async function claimOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.view');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing order id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('orders')
    .update({
      assigned_to: session.profile.id,
      assigned_at: new Date().toISOString(),
      assigned_by: session.profile.id,
      assignment_method: 'self',
      status: 'assigned',
      updated_by: session.profile.id,
    })
    .eq('id', id)
    // Only an unclaimed order can be claimed; this loses the race rather than
    // stealing an order another agent is already working.
    .is('assigned_to', null);

  if (error) return describeDbError(error);

  revalidateOrder(id);
  return { ok: true, message: 'Order assigned to you' };
}

/* -------------------------------------------------------------------------- */
/* Order lines — §4.4, §4.7                                                   */
/* -------------------------------------------------------------------------- */

const itemSchema = z.object({
  order_id: z.string().uuid(),
  variant_id: z.string().trim().optional(),
  name: z.string().trim().min(1, 'Required').max(300),
  sku: z.string().trim().max(64).optional(),
  quantity: z.string().trim().min(1, 'Required'),
  unit_price: z.string().trim().min(1, 'Required'),
  discount: z.string().trim().optional(),
  tax: z.string().trim().optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function saveOrderItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission('orders.edit');

  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const quantity = numberOrNull(parsed.data.quantity);
  const unitPrice = numberOrNull(parsed.data.unit_price);
  if (quantity === null || quantity <= 0) return { fieldErrors: { quantity: 'Must be greater than zero' } };
  if (unitPrice === null || unitPrice < 0) return { fieldErrors: { unit_price: 'Enter a non-negative price' } };

  const supabase = await createServerSupabase();

  const { data: order } = await supabase
    .from('orders')
    .select('id, company_id')
    .eq('id', parsed.data.order_id)
    .maybeSingle();

  if (!order) return { error: 'Order not found.' };

  // A mapped variant carries the catalog identity; a free-text line is still
  // allowed, because an order for an unmapped product must not be rejected.
  const variantId = nullIfBlank(parsed.data.variant_id);
  let productId: string | null = null;

  if (variantId) {
    const { data: variant } = await supabase
      .from('product_variants')
      .select('id, product_id, sku')
      .eq('id', variantId)
      .maybeSingle();
    productId = variant?.product_id ?? null;
  }

  const row = {
    order_id: order.id,
    company_id: order.company_id,
    product_id: productId,
    variant_id: variantId,
    sku: nullIfBlank(parsed.data.sku),
    name: parsed.data.name,
    quantity,
    unit_price: unitPrice,
    discount: numberOrNull(parsed.data.discount) ?? 0,
    tax: numberOrNull(parsed.data.tax) ?? 0,
    notes: nullIfBlank(parsed.data.notes),
  };

  const id = String(formData.get('id') ?? '');

  const { error } = id
    ? await supabase.from('order_items').update(row).eq('id', id)
    : await supabase.from('order_items').insert(row);

  // Rule 5 surfaces here as insufficient_privilege when the order is already
  // with the warehouse.
  if (error) return describeDbError(error);

  revalidateOrder(order.id);
  return { ok: true, message: id ? 'Product updated' : 'Product added' };
}

export async function removeOrderItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission('orders.edit');

  const id = String(formData.get('id') ?? '');
  const orderId = String(formData.get('order_id') ?? '');
  if (!id) return { error: 'Missing item id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('order_items').delete().eq('id', id);
  if (error) return describeDbError(error);

  revalidateOrder(orderId);
  return { ok: true, message: 'Product removed' };
}

/* -------------------------------------------------------------------------- */
/* Calls — §4.10                                                              */
/* -------------------------------------------------------------------------- */

const callSchema = z.object({
  order_id: z.string().uuid(),
  phone: z.string().trim().min(6, 'Required').max(40),
  outcome: z.enum(CALL_OUTCOMES),
  duration_seconds: z.string().trim().optional(),
  recording_url: z.string().trim().max(600).optional(),
  notes: z.string().trim().max(1000).optional(),
  callback_at: z.string().trim().optional(),
});

export async function logCall(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.call.log');

  const parsed = callSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  if (parsed.data.outcome === 'callback_requested' && !nullIfBlank(parsed.data.callback_at)) {
    return { fieldErrors: { callback_at: 'A callback needs a date and time.' } };
  }

  const supabase = await createServerSupabase();

  const { data: order } = await supabase
    .from('orders')
    .select('id, company_id, customer_id, call_attempts')
    .eq('id', parsed.data.order_id)
    .maybeSingle();

  if (!order) return { error: 'Order not found.' };

  const { error } = await supabase.from('order_calls').insert({
    order_id: order.id,
    company_id: order.company_id,
    customer_id: order.customer_id,
    direction: 'outbound',
    attempt_number: order.call_attempts + 1,
    phone: parsed.data.phone,
    duration_seconds: numberOrNull(parsed.data.duration_seconds),
    outcome: parsed.data.outcome,
    recording_url: nullIfBlank(parsed.data.recording_url),
    notes: nullIfBlank(parsed.data.notes),
    callback_at: nullIfBlank(parsed.data.callback_at),
    agent_id: session.profile.id,
  });

  if (error) return describeDbError(error);

  // §4.3 the call outcome moves the order along its lifecycle. The counters and
  // timeline entry are written by the trigger; only the status is a decision.
  const nextStatus =
    parsed.data.outcome === 'callback_requested'
      ? 'callback'
      : order.call_attempts === 0
        ? 'first_call'
        : order.call_attempts === 1
          ? 'second_call'
          : 'third_call';

  await supabase
    .from('orders')
    .update({ status: nextStatus, updated_by: session.profile.id })
    .eq('id', order.id)
    // Never drag a decided order backwards into the calling stages.
    .not('status', 'in', '("confirmed","cancelled","ready_for_warehouse")');

  revalidateOrder(order.id);
  return { ok: true, message: 'Call logged' };
}

/* -------------------------------------------------------------------------- */
/* Messages — §4.9                                                            */
/* -------------------------------------------------------------------------- */

const messageSchema = z.object({
  order_id: z.string().uuid(),
  template_code: z.string().trim().max(64).optional(),
  language: z.enum(['ar', 'en']),
  body: z.string().trim().max(4000).optional(),
  payment_link: z.string().trim().max(600).optional(),
});

/**
 * §4.9 records an outbound message.
 *
 * No WhatsApp Business credentials exist yet, so the row is stored with status
 * `queued` and nothing is transmitted. When the provider is connected, the
 * sender fills in `external_message_id` and advances the status — the record,
 * the timeline entry and the screens do not change.
 */
export async function sendMessage(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.message.send');

  const parsed = messageSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();

  const { data: order } = await supabase
    .from('orders')
    .select('id, company_id, customer_id, order_number, customer_name, total, currency')
    .eq('id', parsed.data.order_id)
    .maybeSingle();

  if (!order) return { error: 'Order not found.' };

  let body = nullIfBlank(parsed.data.body);
  const templateCode = nullIfBlank(parsed.data.template_code);

  if (templateCode && !body) {
    const { data: template } = await supabase
      .from('message_templates')
      .select('body_ar, body_en')
      .eq('company_id', order.company_id)
      .eq('code', templateCode)
      .maybeSingle();

    if (template) {
      const raw = parsed.data.language === 'ar' ? template.body_ar : template.body_en;
      const values: Record<string, string> = {
        customer_name: order.customer_name,
        order_number: order.order_number,
        total: String(order.total),
        currency: order.currency,
        payment_link: nullIfBlank(parsed.data.payment_link) ?? '',
      };
      body = raw.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
    }
  }

  if (!body) return { fieldErrors: { body: 'Choose a template or write a message.' } };

  const { error } = await supabase.from('order_messages').insert({
    order_id: order.id,
    company_id: order.company_id,
    customer_id: order.customer_id,
    channel: 'whatsapp',
    direction: 'outbound',
    status: 'queued',
    template_code: templateCode,
    language: parsed.data.language,
    body,
    payload: parsed.data.payment_link ? { payment_link: parsed.data.payment_link } : null,
    agent_id: session.profile.id,
  });

  if (error) return describeDbError(error);

  revalidateOrder(order.id);
  return { ok: true, message: 'Message queued' };
}

/* -------------------------------------------------------------------------- */
/* Notes — §4.7 "إضافة ملاحظات"                                                */
/* -------------------------------------------------------------------------- */

export async function addOrderNote(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.view');

  const orderId = String(formData.get('order_id') ?? '');
  const summary = nullIfBlank(formData.get('summary'));
  if (!orderId) return { error: 'Missing order id.' };
  if (!summary) return { fieldErrors: { summary: 'Write a note first.' } };

  const supabase = await createServerSupabase();

  const { data: order } = await supabase
    .from('orders')
    .select('id, company_id')
    .eq('id', orderId)
    .maybeSingle();

  if (!order) return { error: 'Order not found.' };

  // `note` is the only event type the insert policy accepts — the timeline is
  // otherwise written exclusively by triggers.
  const { error } = await supabase.from('order_events').insert({
    order_id: order.id,
    company_id: order.company_id,
    event_type: 'note',
    summary,
    actor_id: session.profile.id,
  });

  if (error) return describeDbError(error);

  revalidateOrder(order.id);
  return { ok: true, message: 'Note added' };
}

/* -------------------------------------------------------------------------- */
/* §4.12 duplicate review                                                     */
/* -------------------------------------------------------------------------- */

export async function resolveDuplicate(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.duplicates.view');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing order id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('orders')
    .update({ is_duplicate: false, duplicate_of_id: null, updated_by: session.profile.id })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidateOrder(id);
  return { ok: true, message: 'Marked as not a duplicate' };
}

/* -------------------------------------------------------------------------- */
/* §4.13 blacklist, reachable from the order screen                           */
/* -------------------------------------------------------------------------- */

export async function blacklistFromOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.blacklist.manage');

  const id = String(formData.get('id') ?? '');
  const reason = nullIfBlank(formData.get('reason')) ?? 'Blacklisted from order screen';
  if (!id) return { error: 'Missing order id.' };

  const supabase = await createServerSupabase();

  const { data: order } = await supabase
    .from('orders')
    .select('id, company_id, customer_phone')
    .eq('id', id)
    .maybeSingle();

  if (!order) return { error: 'Order not found.' };

  const { error } = await supabase.from('blacklist_entries').insert({
    company_id: order.company_id,
    scope: 'phone',
    value: order.customer_phone,
    reason,
    created_by: session.profile.id,
  });

  if (error) {
    return describeDbError(error, { uniqueMessage: 'This number is already blacklisted.' });
  }

  revalidatePath('/blacklist');
  revalidateOrder(id);
  return { ok: true, message: 'Number added to the blacklist' };
}
