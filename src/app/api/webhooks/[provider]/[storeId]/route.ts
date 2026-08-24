import { NextResponse, type NextRequest } from 'next/server';
import { resolveChannel } from '@/lib/channels/registry';
import { ingestChannelOrder } from '@/lib/channels/orders';
import { createAdminSupabase } from '@/lib/supabase/server';
import type { SyncEntity } from '@/lib/supabase/database.types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Channel webhook receiver — §2.4.4 "Real-time webhooks".
 *
 * URL shape: /api/webhooks/shopify/<storeId>
 *
 * Three things this endpoint does deliberately:
 *
 *  1. Reads the body as raw text before parsing. The HMAC covers the exact
 *     bytes Shopify sent; parsing and re-serializing would change them and
 *     every signature check would fail.
 *
 *  2. Verifies the signature *before* any database write. An unverified
 *     webhook is an unauthenticated write to a merchant's order book.
 *
 *  3. Returns 200 as soon as the payload is durably recorded. Shopify retries
 *     on non-2xx and disables endpoints that keep failing, so slow downstream
 *     processing must not hold the response open.
 *
 * This route is excluded from the auth middleware — it authenticates by HMAC,
 * not by session.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string; storeId: string }> },
) {
  const { provider, storeId } = await params;

  const rawBody = await request.text();

  let resolved;
  try {
    resolved = await resolveChannel(storeId);
  } catch {
    // Do not disclose whether the store exists to an unauthenticated caller.
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const { adapter, context } = resolved;

  if (adapter.id !== provider && provider !== 'mock') {
    return NextResponse.json({ ok: false, error: 'Provider mismatch' }, { status: 400 });
  }

  const verification = adapter.verifyWebhook(rawBody, request.headers, context.credentials);
  if (!verification.valid) {
    return NextResponse.json({ ok: false, error: verification.reason }, { status: 401 });
  }

  const admin = createAdminSupabase();
  const topic = verification.topic;
  const entity = entityForTopic(topic);

  const { data: logRow } = await admin
    .from('sync_log')
    .insert({
      company_id: context.companyId,
      store_id: storeId,
      entity,
      trigger_source: 'webhook',
      status: 'running',
      records_received: 1,
    })
    .select('id')
    .single();

  try {
    if (topic.startsWith('orders/')) {
      const order = adapter.parseOrderWebhook(verification.payload);
      if (!order) throw new Error(`Could not parse an order from topic '${topic}'.`);

      // Keyed on (store_id, external_id), so a redelivery updates the order
      // instead of creating a second one — and never reverts work an agent has
      // already done on it.
      await ingestChannelOrder(admin, context, adapter.id, order);
    }

    if (logRow) {
      await admin
        .from('sync_log')
        .update({
          status: 'success',
          records_succeeded: 1,
          finished_at: new Date().toISOString(),
        })
        .eq('id', logRow.id);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (logRow) {
      await admin
        .from('sync_log')
        .update({
          status: 'failed',
          records_failed: 1,
          error_details: [{ message, topic }],
          finished_at: new Date().toISOString(),
        })
        .eq('id', logRow.id);
    }

    // 500 so the channel retries — the payload was authentic, we just failed
    // to process it, and dropping it would lose a real order.
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

function entityForTopic(topic: string): SyncEntity {
  if (topic.startsWith('orders/cancel')) return 'cancellations';
  if (topic.startsWith('orders/')) return 'orders';
  if (topic.startsWith('products/')) return 'products';
  if (topic.startsWith('inventory_levels/')) return 'inventory';
  if (topic.startsWith('customers/')) return 'customers';
  if (topic.startsWith('fulfillments/')) return 'fulfillment_status';
  if (topic.startsWith('refunds/')) return 'returns';
  return 'orders';
}
