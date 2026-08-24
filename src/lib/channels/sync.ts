import 'server-only';

import { createAdminSupabase } from '@/lib/supabase/server';
import { resolveChannel } from './registry';
import { ingestChannelOrder } from './orders';
import type { SyncEntity, SyncTrigger } from '@/lib/supabase/database.types';

export type SyncResult = {
  entity: SyncEntity;
  received: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  status: 'success' | 'partial' | 'failed';
  errors: { message: string; externalId?: string }[];
};

/**
 * Runs one synchronization pass and records it (§2.4.5).
 *
 * Every run is logged whatever the outcome — a sync that fails silently is
 * worse than one that fails loudly, because the store then looks healthy while
 * orders quietly stop arriving. The log row is opened before the work starts
 * so a crashed process still leaves a 'running' record to investigate.
 *
 * Orders are persisted for real (§4.2); products and inventory still record
 * counts only, and write their rows when Phase 4 lands.
 */
export async function runSync(options: {
  storeId: string;
  entity: SyncEntity;
  trigger: SyncTrigger;
  initiatedBy?: string | null;
  updatedSince?: string;
}): Promise<SyncResult> {
  const { storeId, entity, trigger, initiatedBy = null, updatedSince } = options;
  const admin = createAdminSupabase();
  const startedAt = Date.now();

  const { adapter, context, fellBackToMock } = await resolveChannel(storeId);

  const { data: logRow } = await admin
    .from('sync_log')
    .insert({
      company_id: context.companyId,
      store_id: storeId,
      entity,
      trigger_source: trigger,
      status: 'running',
      initiated_by: initiatedBy,
    })
    .select('id')
    .single();

  const errors: { message: string; externalId?: string }[] = [];
  let received = 0;
  let succeeded = 0;

  if (fellBackToMock) {
    errors.push({
      message:
        'Store is configured for Shopify but no usable credentials were found; ran against the mock provider instead.',
    });
  }

  try {
    if (!adapter.supports.has(entity)) {
      throw new Error(`Adapter '${adapter.id}' does not support entity '${entity}'.`);
    }

    let cursor: string | null = null;

    do {
      if (entity === 'orders') {
        const page = await adapter.fetchOrders(context, { cursor, updatedSince, limit: 50 });
        received += page.items.length;

        // Per order rather than per page: one malformed order must not discard
        // the 49 valid ones alongside it, and the log has to say which failed.
        for (const order of page.items) {
          try {
            await ingestChannelOrder(admin, context, adapter.id, order);
            succeeded += 1;
          } catch (orderError) {
            errors.push({
              message: orderError instanceof Error ? orderError.message : String(orderError),
              externalId: order.externalId,
            });
          }
        }

        cursor = page.nextCursor;
      } else if (entity === 'products' || entity === 'variants') {
        const page = await adapter.fetchProducts(context, { cursor, updatedSince, limit: 50 });
        received += page.items.length;
        // Phase 2 writes these into `products` / `product_variants` here.
        succeeded += page.items.length;
        cursor = page.nextCursor;
      } else if (entity === 'inventory') {
        const page = await adapter.fetchInventoryLevels(context, { cursor, updatedSince, limit: 50 });
        received += page.items.length;
        // Phase 4 writes these into `inventory_levels` here.
        succeeded += page.items.length;
        cursor = page.nextCursor;
      } else {
        throw new Error(`Entity '${entity}' has no sync handler yet.`);
      }
    } while (cursor);
  } catch (error) {
    errors.push({ message: error instanceof Error ? error.message : String(error) });
  }

  const failed = received - succeeded;
  const durationMs = Date.now() - startedAt;

  const status: SyncResult['status'] =
    errors.some((e) => !e.message.startsWith('Store is configured for Shopify')) && succeeded === 0
      ? 'failed'
      : failed > 0 || errors.length > 0
        ? 'partial'
        : 'success';

  if (logRow) {
    await admin
      .from('sync_log')
      .update({
        status,
        records_received: received,
        records_succeeded: succeeded,
        records_failed: failed,
        error_details: errors.length > 0 ? errors : null,
        duration_ms: durationMs,
        finished_at: new Date().toISOString(),
      })
      .eq('id', logRow.id);
  }

  await admin
    .from('stores')
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_status: status,
      last_sync_error: errors[0]?.message ?? null,
    })
    .eq('id', storeId);

  return { entity, received, succeeded, failed, durationMs, status, errors };
}
