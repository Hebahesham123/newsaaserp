'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { runSync } from '@/lib/channels/sync';
import type { SyncEntity } from '@/lib/supabase/database.types';

const storeSchema = z.object({
  merchant_id: z.string().uuid('Select a merchant'),
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'Code may contain letters, digits, hyphen and underscore only'),
  name: z.string().trim().min(2).max(200),
  platform: z.enum([
    'shopify', 'woocommerce', 'amazon', 'noon', 'custom_store', 'mobile_app',
    'pos', 'branch', 'social_commerce', 'manual', 'wholesale', 'other_marketplace',
  ]),
  store_url: z.string().trim().url().optional().or(z.literal('')),
  currency: z.string().trim().length(3).default('EGP'),
  country: z.string().trim().max(80).optional().or(z.literal('')),
});

export type StoreFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function createStore(_prev: StoreFormState, formData: FormData): Promise<StoreFormState> {
  const session = await requirePermission('stores.create');

  const parsed = storeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { fieldErrors };
  }

  const values = parsed.data;
  const supabase = await createServerSupabase();

  // Derive company_id from the merchant rather than trusting the form. A
  // client-supplied company_id would be an obvious cross-tenant write vector,
  // and RLS would reject it anyway — deriving it makes the intent explicit.
  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, company_id')
    .eq('id', values.merchant_id)
    .maybeSingle();

  if (!merchant) return { fieldErrors: { merchant_id: 'Merchant not found.' } };

  const { data, error } = await supabase
    .from('stores')
    .insert({
      company_id: merchant.company_id,
      merchant_id: merchant.id,
      code: values.code,
      name: values.name,
      platform: values.platform,
      store_url: values.store_url || null,
      currency: values.currency.toUpperCase(),
      country: values.country || null,
      // New stores start on the mock provider so the pipeline is immediately
      // exercisable. Connecting real credentials flips this to the platform.
      provider: 'mock',
      status: 'draft',
      sync_enabled: true,
      created_by: session.profile.id,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      return { fieldErrors: { code: 'This code is already used in your company.' } };
    }
    return { error: error.message };
  }

  revalidatePath('/stores');
  redirect(`/stores/${data.id}`);
}

const SYNCABLE: SyncEntity[] = ['orders', 'products', 'inventory'];

/** §2.4.4 "Manual synchronization" — the Sync now button. */
export async function triggerSync(formData: FormData): Promise<void> {
  const session = await requirePermission('stores.sync.trigger');

  const storeId = String(formData.get('storeId') ?? '');
  const entityRaw = String(formData.get('entity') ?? 'orders');
  const entity = (SYNCABLE.includes(entityRaw as SyncEntity) ? entityRaw : 'orders') as SyncEntity;

  if (!storeId) return;

  // Confirm the caller can actually see this store before using the service
  // role to sync it. Without this check, sync would bypass the tenant boundary.
  const supabase = await createServerSupabase();
  const { data: store } = await supabase.from('stores').select('id').eq('id', storeId).maybeSingle();
  if (!store) return;

  await runSync({ storeId, entity, trigger: 'manual', initiatedBy: session.profile.id });

  revalidatePath(`/stores/${storeId}`);
  revalidatePath('/sync-log');
}
