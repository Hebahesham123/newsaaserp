'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { archiveRow, revalidateEntity } from '@/lib/actions';
import { runSync } from '@/lib/channels/sync';
import type { SyncEntity } from '@/lib/supabase/database.types';
import {
  checkbox,
  describeDbError,
  fieldErrorsFrom,
  nullIfBlank,
  type ActionState,
} from '@/lib/forms';

const PLATFORMS = [
  'shopify', 'woocommerce', 'amazon', 'noon', 'custom_store', 'mobile_app',
  'pos', 'branch', 'social_commerce', 'manual', 'wholesale', 'other_marketplace',
] as const;

const STORE_STATUS = [
  'draft', 'not_connected', 'connection_in_progress', 'connected', 'active',
  'connection_error', 'temporarily_suspended', 'disconnected', 'archived',
] as const;

const SYNC_METHODS = ['webhook', 'scheduled', 'manual', 'disabled'] as const;

const storeSchema = z.object({
  merchant_id: z.string().uuid('Select a merchant'),
  code: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, hyphen and underscore only'),
  name: z.string().trim().min(2, 'Required').max(200),
  platform: z.enum(PLATFORMS),
  store_url: z.string().trim().url('Must be a full URL').optional().or(z.literal('')),
  currency: z.string().trim().length(3, 'Three-letter code'),
  country: z.string().trim().max(80).optional(),
  locale: z.enum(['ar', 'en']),
  timezone: z.string().trim().max(60).optional(),
  default_warehouse_id: z.string().trim().optional(),
  store_manager_id: z.string().trim().optional(),
  order_import_method: z.enum(SYNC_METHODS),
  product_sync_method: z.enum(SYNC_METHODS),
  inventory_sync_method: z.enum(SYNC_METHODS),
  price_sync_method: z.enum(SYNC_METHODS),
  notes: z.string().trim().max(2000).optional(),
});

function toRow(values: z.infer<typeof storeSchema>, syncEnabled: boolean) {
  return {
    code: values.code,
    name: values.name,
    platform: values.platform,
    store_url: nullIfBlank(values.store_url),
    currency: values.currency.toUpperCase(),
    country: nullIfBlank(values.country),
    locale: values.locale,
    timezone: nullIfBlank(values.timezone) ?? 'Africa/Cairo',
    default_warehouse_id: nullIfBlank(values.default_warehouse_id),
    store_manager_id: nullIfBlank(values.store_manager_id),
    order_import_method: values.order_import_method,
    product_sync_method: values.product_sync_method,
    inventory_sync_method: values.inventory_sync_method,
    price_sync_method: values.price_sync_method,
    sync_enabled: syncEnabled,
    notes: nullIfBlank(values.notes),
  };
}

export async function createStore(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('stores.create');

  const parsed = storeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();

  // Derive company_id from the merchant rather than trusting the form. A
  // client-supplied company_id would be an obvious cross-tenant write vector,
  // and RLS would reject it anyway — deriving it makes the intent explicit.
  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, company_id')
    .eq('id', parsed.data.merchant_id)
    .maybeSingle();

  if (!merchant) return { fieldErrors: { merchant_id: 'Merchant not found.' } };

  const { data, error } = await supabase
    .from('stores')
    .insert({
      ...toRow(parsed.data, checkbox(formData, 'sync_enabled')),
      company_id: merchant.company_id,
      merchant_id: merchant.id,
      // New stores start on the mock provider so the pipeline is immediately
      // exercisable. Connecting real credentials flips this to the platform.
      provider: 'mock',
      status: 'draft',
      created_by: session.profile.id,
    })
    .select('id')
    .single();

  if (error) {
    return describeDbError(error, {
      uniqueField: 'code',
      uniqueMessage: 'This code is already used in this company.',
    });
  }

  revalidateEntity('/stores', data.id);
  return { ok: true, message: 'Store created' };
}

export async function updateStore(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('stores.edit');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing store id.' };

  const parsed = storeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();

  // Moving a store between merchants must stay inside the company; the
  // stores_tenant_consistency trigger enforces it, this reports it usefully.
  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, company_id')
    .eq('id', parsed.data.merchant_id)
    .maybeSingle();

  if (!merchant) return { fieldErrors: { merchant_id: 'Merchant not found.' } };

  const { error } = await supabase
    .from('stores')
    .update({
      ...toRow(parsed.data, checkbox(formData, 'sync_enabled')),
      merchant_id: merchant.id,
      updated_by: session.profile.id,
    })
    .eq('id', id);

  if (error) {
    return describeDbError(error, {
      uniqueField: 'code',
      uniqueMessage: 'This code is already used in this company.',
    });
  }

  revalidateEntity('/stores', id);
  return { ok: true, message: 'Store updated' };
}

/**
 * §2.4.3 status transitions — connect, disconnect, suspend, reactivate.
 *
 * Connecting is deliberately separate from editing: it is the point where a
 * store starts pulling orders, and it carries its own permission.
 */
export async function setStoreStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const requested = String(formData.get('status') ?? '');
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing store id.' };

  const parsedStatus = z.enum(STORE_STATUS).safeParse(requested);
  if (!parsedStatus.success) return { error: 'Unknown status.' };
  const status = parsedStatus.data;

  // Connecting and disconnecting are gated separately from ordinary edits.
  const permission =
    status === 'connected' || status === 'active'
      ? 'stores.connect'
      : status === 'disconnected'
        ? 'stores.disconnect'
        : 'stores.edit';

  const session = await requirePermission(permission);
  const supabase = await createServerSupabase();

  const patch: {
    status: (typeof STORE_STATUS)[number];
    updated_by: string;
    connected_at?: string;
    last_sync_error?: string | null;
    sync_enabled?: boolean;
  } = { status, updated_by: session.profile.id };

  if (status === 'connected' || status === 'active') {
    patch.connected_at = new Date().toISOString();
    patch.last_sync_error = null;
  }
  if (status === 'disconnected') {
    patch.sync_enabled = false;
  }

  const { error } = await supabase.from('stores').update(patch).eq('id', id);
  if (error) return describeDbError(error);

  revalidateEntity('/stores', id);
  return { ok: true, message: 'Store status updated' };
}

const SYNCABLE: SyncEntity[] = ['orders', 'products', 'inventory'];

/** §2.4.4 "Manual synchronization" — the Sync now button. */
export async function triggerSync(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('stores.sync.trigger');

  const storeId = String(formData.get('storeId') ?? formData.get('id') ?? '');
  const entityRaw = String(formData.get('entity') ?? 'orders');
  const entity = (SYNCABLE.includes(entityRaw as SyncEntity) ? entityRaw : 'orders') as SyncEntity;

  if (!storeId) return { error: 'Missing store id.' };

  // Confirm the caller can actually see this store before using the service
  // role to sync it. Without this check, sync would bypass the tenant boundary.
  const supabase = await createServerSupabase();
  const { data: store } = await supabase.from('stores').select('id').eq('id', storeId).maybeSingle();
  if (!store) return { error: 'Store not found.' };

  const run = await runSync({ storeId, entity, trigger: 'manual', initiatedBy: session.profile.id });

  revalidateEntity('/stores', storeId);
  revalidatePath('/sync-log');

  return {
    ok: true,
    message: `Sync ${run.status} — ${run.received} received, ${run.failed} failed`,
  };
}

export async function archiveStore(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('stores.archive');
  const id = String(formData.get('id') ?? '');
  const restore = formData.get('restore') != null;
  if (!id) return { error: 'Missing store id.' };

  const result = await archiveRow('stores', id, session, restore);
  if (result.ok) revalidateEntity('/stores', id);
  return result;
}
