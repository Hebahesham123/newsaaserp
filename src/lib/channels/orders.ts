import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChannelContext, ChannelOrder, ChannelLineItem } from './types';
import type {
  Database,
  OrderPaymentStatus,
  OrderSource,
  PaymentMethod,
} from '@/lib/supabase/database.types';

type Admin = SupabaseClient<Database>;

/**
 * Channel order → `orders` + `order_items` (§4.2, §4.4).
 *
 * Three properties this has to hold, all of which are about *not* losing work:
 *
 *  1. **Idempotent.** Shopify redelivers webhooks, and a scheduled sync overlaps
 *     the webhook that already arrived. Ingestion is keyed on
 *     (store_id, external_id) so the second delivery updates rather than
 *     duplicating.
 *
 *  2. **Non-destructive.** Once an agent has started working an order — edited
 *     the address, logged a call, confirmed it — a later sync must not revert
 *     any of that. Past the intake stage only channel-owned facts (payment and
 *     fulfilment state) are refreshed.
 *
 *  3. **Tolerant of an incomplete catalog.** §3.13 rule 13 means a line may
 *     reference a variant that is not mapped yet. The line is still stored,
 *     flagged by a null `variant_id`, because refusing it would lose a real
 *     order.
 */

/** §4.2 maps a channel provider onto the spec's order-source list. */
function sourceForProvider(provider: string): OrderSource {
  switch (provider) {
    case 'shopify':
      return 'shopify';
    case 'woocommerce':
      return 'woocommerce';
    case 'amazon':
      return 'amazon';
    case 'noon':
      return 'noon';
    default:
      // The mock adapter stands in for a real storefront, so its orders behave
      // like custom-API orders rather than manual entry.
      return 'custom_api';
  }
}

function paymentStatusFor(status: ChannelOrder['paymentStatus']): OrderPaymentStatus {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'partially_paid':
      return 'partially_paid';
    case 'authorized':
      return 'authorized';
    case 'refunded':
      return 'refunded';
    case 'voided':
      return 'voided';
    default:
      return 'pending';
  }
}

/**
 * COD is the default in this market and channels rarely label it explicitly, so
 * an unpaid order with a COD amount is treated as cash on delivery.
 */
function paymentMethodFor(order: ChannelOrder): PaymentMethod {
  const raw = (order.paymentMethod ?? '').toLowerCase();
  if (raw.includes('cash') || raw.includes('cod')) return 'cod';
  if (raw.includes('card') || raw.includes('credit')) return 'card';
  if (raw.includes('wallet')) return 'wallet';
  if (raw.includes('transfer') || raw.includes('bank')) return 'bank_transfer';
  if (raw) return 'other';
  return order.paymentStatus === 'paid' ? 'card' : 'cod';
}

export type IngestResult = {
  orderId: string;
  created: boolean;
  /** Lines that reference a channel variant with no catalog mapping (§3.13 rule 13). */
  unmappedLines: number;
};

/**
 * Resolves channel line items to catalog variants through the §3.5 mapping
 * table, in one query rather than one per line.
 */
async function resolveVariants(
  admin: Admin,
  storeId: string,
  lines: ChannelLineItem[],
): Promise<Map<string, { variantId: string; productId: string }>> {
  const externalIds = lines
    .map((line) => line.externalVariantId)
    .filter((value): value is string => Boolean(value));

  const resolved = new Map<string, { variantId: string; productId: string }>();
  if (externalIds.length === 0) return resolved;

  const { data } = await admin
    .from('product_channel_mappings')
    .select('external_variant_id, variant_id, product_id')
    .eq('store_id', storeId)
    .eq('status', 'mapped')
    .in('external_variant_id', externalIds);

  for (const row of data ?? []) {
    if (row.external_variant_id && row.variant_id) {
      resolved.set(row.external_variant_id, {
        variantId: row.variant_id,
        productId: row.product_id,
      });
    }
  }

  return resolved;
}

/** §4.8 find-or-create the customer this order belongs to. */
async function resolveCustomer(
  admin: Admin,
  context: ChannelContext,
  order: ChannelOrder,
): Promise<string | null> {
  const phone =
    order.shippingAddress?.phone ?? order.customer?.phone ?? order.billingAddress?.phone ?? null;

  // No phone means no identity in this market; the order is still stored, it
  // just does not join a customer record.
  if (!phone) return null;

  const name =
    [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ') ||
    order.shippingAddress?.name ||
    'Unknown customer';

  const { data: existing } = await admin
    .from('customers')
    .select('id')
    .eq('company_id', context.companyId)
    .eq('phone', phone)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created } = await admin
    .from('customers')
    .insert({
      company_id: context.companyId,
      merchant_id: context.merchantId,
      phone,
      name,
      email: order.customer?.email ?? null,
      governorate: order.shippingAddress?.region ?? null,
      city: order.shippingAddress?.city ?? null,
      address: [order.shippingAddress?.address1, order.shippingAddress?.address2]
        .filter(Boolean)
        .join(', ') || null,
      latitude: order.shippingAddress?.latitude ?? null,
      longitude: order.shippingAddress?.longitude ?? null,
    })
    .select('id')
    .single();

  return created?.id ?? null;
}

export async function ingestChannelOrder(
  admin: Admin,
  context: ChannelContext,
  provider: string,
  order: ChannelOrder,
): Promise<IngestResult> {
  const { data: existing } = await admin
    .from('orders')
    .select('id, status, stage')
    .eq('store_id', context.storeId)
    .eq('external_id', order.externalId)
    .maybeSingle();

  const paymentStatus = paymentStatusFor(order.paymentStatus);

  // ---------------------------------------------------------------------
  // Already ingested: refresh only what the channel still owns.
  // ---------------------------------------------------------------------
  if (existing) {
    const stillInIntake = existing.stage === 'intake';

    await admin
      .from('orders')
      .update({
        payment_status: paymentStatus,
        raw: order.raw as never,
        // A cancellation on the channel is authoritative, but the local
        // lifecycle rules still apply: cancelling here would need a reason, so
        // the order is flagged for review rather than force-cancelled.
        ...(stillInIntake
          ? {
              customer_name:
                [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ') ||
                order.shippingAddress?.name ||
                'Unknown customer',
              customer_email: order.customer?.email ?? null,
              governorate: order.shippingAddress?.region ?? null,
              city: order.shippingAddress?.city ?? null,
              address:
                [order.shippingAddress?.address1, order.shippingAddress?.address2]
                  .filter(Boolean)
                  .join(', ') || null,
              shipping_fees: order.shipping.amount,
            }
          : {}),
        ...(order.cancelledAt && stillInIntake ? { status: 'pending_review' as const } : {}),
      })
      .eq('id', existing.id);

    return { orderId: existing.id, created: false, unmappedLines: 0 };
  }

  // ---------------------------------------------------------------------
  // New order.
  // ---------------------------------------------------------------------
  const customerId = await resolveCustomer(admin, context, order);

  const phone =
    order.shippingAddress?.phone ?? order.customer?.phone ?? order.billingAddress?.phone ?? '';

  const customerName =
    [order.customer?.firstName, order.customer?.lastName].filter(Boolean).join(' ') ||
    order.shippingAddress?.name ||
    'Unknown customer';

  const { data: created, error } = await admin
    .from('orders')
    .insert({
      company_id: context.companyId,
      merchant_id: context.merchantId,
      store_id: context.storeId,
      customer_id: customerId,
      source: sourceForProvider(provider),
      external_id: order.externalId,
      external_order_number: order.externalNumber,
      order_date: order.createdAt,
      // §4.3 stage 1: an imported order enters at `imported` and is verified
      // before anyone calls the customer.
      status: 'imported',
      customer_name: customerName,
      customer_phone: phone || 'unknown',
      customer_email: order.customer?.email ?? null,
      governorate: order.shippingAddress?.region ?? null,
      city: order.shippingAddress?.city ?? null,
      address:
        [order.shippingAddress?.address1, order.shippingAddress?.address2]
          .filter(Boolean)
          .join(', ') || null,
      latitude: order.shippingAddress?.latitude ?? null,
      longitude: order.shippingAddress?.longitude ?? null,
      payment_method: paymentMethodFor(order),
      payment_status: paymentStatus,
      currency: order.currency,
      shipping_fees: order.shipping.amount,
      cod_amount: order.codAmount?.amount ?? null,
      tags: order.tags,
      notes: order.note,
      campaign_ref: order.sourceName,
      raw: order.raw as never,
    })
    .select('id')
    .single();

  if (error || !created) {
    throw new Error(`Failed to store order ${order.externalNumber}: ${error?.message ?? 'unknown'}`);
  }

  // Lines are inserted after the order so the recalculation trigger has a row
  // to update; totals therefore come from the lines, not from the channel's
  // arithmetic.
  const variantMap = await resolveVariants(admin, context.storeId, order.lineItems);
  let unmappedLines = 0;

  const itemRows = order.lineItems.map((line, index) => {
    const match = line.externalVariantId ? variantMap.get(line.externalVariantId) : undefined;
    if (!match) unmappedLines += 1;

    return {
      order_id: created.id,
      company_id: context.companyId,
      product_id: match?.productId ?? null,
      variant_id: match?.variantId ?? null,
      sku: line.sku,
      name: line.title,
      variant_name: line.variantTitle,
      external_line_id: line.externalId,
      quantity: line.quantity,
      unit_price: line.unitPrice.amount,
      discount: line.discount?.amount ?? 0,
      position: index,
    };
  });

  if (itemRows.length > 0) {
    const { error: itemError } = await admin.from('order_items').insert(itemRows);
    if (itemError) {
      throw new Error(
        `Order ${order.externalNumber} stored, but its lines failed: ${itemError.message}`,
      );
    }
  }

  return { orderId: created.id, created: true, unmappedLines };
}
