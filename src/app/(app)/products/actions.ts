'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { archiveRow } from '@/lib/actions';
import {
  checkbox,
  describeDbError,
  fieldErrorsFrom,
  multi,
  nullIfBlank,
  numberOrNull,
  type ActionState,
} from '@/lib/forms';
import type { ProductStatus } from '@/lib/supabase/database.types';

const PRODUCT_TYPES = [
  'simple', 'variant', 'bundle', 'kit', 'composite', 'digital', 'service',
  'marketplace', 'made_to_order', 'batch_controlled', 'serial_controlled',
] as const;

const PRODUCT_STATUSES = [
  'draft', 'under_review', 'active', 'inactive', 'unavailable', 'out_of_stock',
  'temporarily_suspended', 'discontinued', 'archived', 'sync_error', 'unmapped',
] as const;

const PRICE_TYPES = [
  'base', 'compare_at', 'wholesale', 'store', 'merchant', 'marketplace',
  'country', 'affiliate', 'promotional', 'bundle', 'time_based', 'quantity_based',
] as const;

const COST_COMPONENTS = [
  'purchase', 'manufacturing', 'freight', 'customs', 'packaging', 'storage',
  'fulfillment', 'marketplace_commission', 'affiliate_commission',
  'payment_gateway', 'customer_shipping', 'other',
] as const;

function revalidateCatalog(productId?: string) {
  revalidatePath('/products');
  revalidatePath('/products/unmapped');
  revalidatePath('/price-history');
  if (productId) revalidatePath(`/products/${productId}`);
  revalidatePath('/');
}

/* -------------------------------------------------------------------------- */
/* Products — §3.2                                                            */
/* -------------------------------------------------------------------------- */

const productSchema = z.object({
  merchant_id: z.string().uuid('Select a merchant'),
  sku: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dot, hyphen and underscore only'),
  barcode: z.string().trim().max(64).optional(),
  name_en: z.string().trim().min(2, 'Required').max(300),
  name_ar: z.string().trim().min(2, 'Required').max(300),
  short_description: z.string().trim().max(500).optional(),
  description: z.string().trim().max(5000).optional(),
  product_type: z.enum(PRODUCT_TYPES),
  status: z.enum(PRODUCT_STATUSES),
  brand_id: z.string().trim().optional(),
  category_id: z.string().trim().optional(),
  supplier_id: z.string().trim().optional(),
  uom_id: z.string().trim().optional(),
  weight_grams: z.string().trim().optional(),
  length_cm: z.string().trim().optional(),
  width_cm: z.string().trim().optional(),
  height_cm: z.string().trim().optional(),
  country_of_origin: z.string().trim().max(80).optional(),
  base_price: z.string().trim().optional(),
  base_cost: z.string().trim().optional(),
  currency: z.string().trim().length(3, 'Three-letter code'),
  tax_rate: z.string().trim().optional(),
  min_sale_quantity: z.string().trim().optional(),
  max_sale_quantity: z.string().trim().optional(),
  shelf_life_days: z.string().trim().optional(),
  tags: z.string().trim().max(500).optional(),
  internal_notes: z.string().trim().max(2000).optional(),
});

function tagList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function toProductRow(values: z.infer<typeof productSchema>, formData: FormData) {
  return {
    merchant_id: values.merchant_id,
    sku: values.sku,
    barcode: nullIfBlank(values.barcode),
    name_en: values.name_en,
    name_ar: values.name_ar,
    short_description: nullIfBlank(values.short_description),
    description: nullIfBlank(values.description),
    product_type: values.product_type,
    status: values.status,
    brand_id: nullIfBlank(values.brand_id),
    category_id: nullIfBlank(values.category_id),
    supplier_id: nullIfBlank(values.supplier_id),
    uom_id: nullIfBlank(values.uom_id),
    weight_grams: numberOrNull(values.weight_grams),
    length_cm: numberOrNull(values.length_cm),
    width_cm: numberOrNull(values.width_cm),
    height_cm: numberOrNull(values.height_cm),
    country_of_origin: nullIfBlank(values.country_of_origin),
    base_price: numberOrNull(values.base_price),
    base_cost: numberOrNull(values.base_cost),
    currency: values.currency.toUpperCase(),
    tax_rate: numberOrNull(values.tax_rate),
    tax_included: checkbox(formData, 'tax_included'),
    min_sale_quantity: numberOrNull(values.min_sale_quantity) ?? 1,
    max_sale_quantity: numberOrNull(values.max_sale_quantity),
    is_sellable: checkbox(formData, 'is_sellable'),
    is_stock_item: checkbox(formData, 'is_stock_item'),
    is_batch_tracked: checkbox(formData, 'is_batch_tracked'),
    is_expiry_tracked: checkbox(formData, 'is_expiry_tracked'),
    is_serial_tracked: checkbox(formData, 'is_serial_tracked'),
    shelf_life_days: numberOrNull(values.shelf_life_days),
    tags: tagList(values.tags),
    is_seasonal: checkbox(formData, 'is_seasonal'),
    internal_notes: nullIfBlank(values.internal_notes),
  };
}

export async function createProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('products.create');

  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();

  // §3.13 rule 1 — company_id comes from the merchant, never from the form.
  const { data: merchant } = await supabase
    .from('merchants')
    .select('id, company_id')
    .eq('id', parsed.data.merchant_id)
    .maybeSingle();

  if (!merchant) return { fieldErrors: { merchant_id: 'Merchant not found.' } };

  const row = toProductRow(parsed.data, formData);

  const { data, error } = await supabase
    .from('products')
    .insert({ ...row, company_id: merchant.company_id, created_by: session.profile.id })
    .select('id')
    .single();

  if (error) {
    return describeDbError(error, {
      uniqueField: 'sku',
      uniqueMessage: 'This SKU is already used by this merchant (§3.13 rule 3).',
    });
  }

  // Every product gets one sellable unit. A simple product keeps just this one;
  // a variant product adds more and this stays as the fallback listing.
  const { error: variantError } = await supabase.from('product_variants').insert({
    product_id: data.id,
    company_id: merchant.company_id,
    merchant_id: merchant.id,
    sku: row.sku,
    barcode: row.barcode,
    price: row.base_price,
    cost: row.base_cost,
    weight_grams: row.weight_grams,
    is_default: true,
    is_active: true,
    created_by: session.profile.id,
  });

  if (variantError) {
    return {
      error: `Product created, but its default variant failed: ${variantError.message}`,
    };
  }

  revalidateCatalog(data.id);
  return { ok: true, message: 'Product created' };
}

export async function updateProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('products.edit');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing product id.' };

  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('products')
    .update({ ...toProductRow(parsed.data, formData), updated_by: session.profile.id })
    .eq('id', id);

  if (error) {
    return describeDbError(error, {
      uniqueField: 'sku',
      uniqueMessage: 'This SKU is already used by this merchant (§3.13 rule 3).',
    });
  }

  revalidateCatalog(id);
  return { ok: true, message: 'Product updated' };
}

/**
 * §3.12 "Change product status" — a separate permission from editing, because
 * activating a listing is what makes it sellable. Rule 11 (no publishing without
 * a price) is enforced by the database, and its message is surfaced as-is.
 */
export async function setProductStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('products.status');

  const id = String(formData.get('id') ?? '');
  const requested = String(formData.get('status') ?? '');
  if (!id) return { error: 'Missing product id.' };

  const parsedStatus = z.enum(PRODUCT_STATUSES).safeParse(requested);
  if (!parsedStatus.success) return { error: 'Unknown status.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('products')
    .update({ status: parsedStatus.data as ProductStatus, updated_by: session.profile.id })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidateCatalog(id);
  return { ok: true, message: `Status set to ${parsedStatus.data}` };
}

/** §3.12 "Approve products" — the catalog sign-off before a listing goes live. */
export async function approveProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('products.approve');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing product id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('products')
    .update({
      approved_at: new Date().toISOString(),
      approved_by: session.profile.id,
      updated_by: session.profile.id,
    })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidateCatalog(id);
  return { ok: true, message: 'Product approved' };
}

export async function archiveProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('products.archive');
  const id = String(formData.get('id') ?? '');
  const restore = formData.get('restore') != null;
  if (!id) return { error: 'Missing product id.' };

  // §3.13 rule 9: products with history are archived, never deleted. No table
  // here grants DELETE to a client role, so this is the only path.
  const result = await archiveRow('products', id, session, restore);
  if (result.ok) revalidateCatalog(id);
  return result;
}

/* -------------------------------------------------------------------------- */
/* Variants — §3.4                                                            */
/* -------------------------------------------------------------------------- */

const variantSchema = z.object({
  product_id: z.string().uuid(),
  sku: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dot, hyphen and underscore only'),
  barcode: z.string().trim().max(64).optional(),
  name: z.string().trim().max(200).optional(),
  price: z.string().trim().optional(),
  cost: z.string().trim().optional(),
  weight_grams: z.string().trim().optional(),
  image_url: z.string().trim().max(600).optional(),
  position: z.string().trim().optional(),
});

/**
 * §3.4 option axes arrive as parallel `option_name[]` / `option_value[]` inputs
 * and are folded into the variant's options object.
 */
function optionsFrom(formData: FormData): Record<string, string> {
  const names = multi(formData, 'option_name');
  const values = multi(formData, 'option_value');
  const options: Record<string, string> = {};

  names.forEach((name, index) => {
    const value = values[index];
    if (name && value) options[name] = value;
  });

  return options;
}

export async function createVariant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('products.edit');

  const parsed = variantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();

  // The tenant columns are filled by the variant consistency trigger, but the
  // product must be readable by this user first.
  const { data: product } = await supabase
    .from('products')
    .select('id, company_id, merchant_id, product_type')
    .eq('id', parsed.data.product_id)
    .maybeSingle();

  if (!product) return { error: 'Product not found.' };

  const { error } = await supabase.from('product_variants').insert({
    product_id: product.id,
    company_id: product.company_id,
    merchant_id: product.merchant_id,
    sku: parsed.data.sku,
    barcode: nullIfBlank(parsed.data.barcode),
    name: nullIfBlank(parsed.data.name),
    options: optionsFrom(formData),
    price: numberOrNull(parsed.data.price),
    cost: numberOrNull(parsed.data.cost),
    weight_grams: numberOrNull(parsed.data.weight_grams),
    image_url: nullIfBlank(parsed.data.image_url),
    position: numberOrNull(parsed.data.position) ?? 0,
    is_active: checkbox(formData, 'is_active'),
    is_default: false,
    created_by: session.profile.id,
  });

  if (error) {
    return describeDbError(error, {
      uniqueField: 'sku',
      uniqueMessage: 'This SKU is already used by this merchant (§3.13 rule 3).',
    });
  }

  // A product with more than one sellable unit is a variant product.
  if (product.product_type === 'simple') {
    await supabase.from('products').update({ product_type: 'variant' }).eq('id', product.id);
  }

  revalidateCatalog(product.id);
  return { ok: true, message: 'Variant added' };
}

export async function updateVariant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('products.edit');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing variant id.' };

  const parsed = variantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('product_variants')
    .update({
      sku: parsed.data.sku,
      barcode: nullIfBlank(parsed.data.barcode),
      name: nullIfBlank(parsed.data.name),
      options: optionsFrom(formData),
      price: numberOrNull(parsed.data.price),
      cost: numberOrNull(parsed.data.cost),
      weight_grams: numberOrNull(parsed.data.weight_grams),
      image_url: nullIfBlank(parsed.data.image_url),
      position: numberOrNull(parsed.data.position) ?? 0,
      is_active: checkbox(formData, 'is_active'),
      updated_by: session.profile.id,
    })
    .eq('id', id);

  if (error) {
    return describeDbError(error, {
      uniqueField: 'sku',
      uniqueMessage: 'This SKU is already used by this merchant (§3.13 rule 3).',
    });
  }

  revalidateCatalog(parsed.data.product_id);
  return { ok: true, message: 'Variant updated' };
}

export async function archiveVariant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('products.edit');

  const id = String(formData.get('id') ?? '');
  const productId = String(formData.get('product_id') ?? '');
  const restore = formData.get('restore') != null;
  if (!id) return { error: 'Missing variant id.' };

  const supabase = await createServerSupabase();

  // The default variant is the product's only sellable unit when it is simple;
  // removing it would leave nothing to order.
  const { data: variant } = await supabase
    .from('product_variants')
    .select('id, is_default')
    .eq('id', id)
    .maybeSingle();

  if (!variant) return { error: 'Variant not found.' };
  if (variant.is_default && !restore) {
    return { error: 'The default variant cannot be archived. Archive the product instead.' };
  }

  const { error } = await supabase
    .from('product_variants')
    .update({
      archived_at: restore ? null : new Date().toISOString(),
      archived_by: restore ? null : session.profile.id,
      is_active: restore,
      updated_by: session.profile.id,
    })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidateCatalog(productId);
  return { ok: true, message: restore ? 'Variant restored' : 'Variant archived' };
}

/* -------------------------------------------------------------------------- */
/* Price matrix — §3.7                                                        */
/* -------------------------------------------------------------------------- */

const priceSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().trim().optional(),
  price_type: z.enum(PRICE_TYPES),
  amount: z.string().trim().min(1, 'Required'),
  currency: z.string().trim().length(3, 'Three-letter code'),
  store_id: z.string().trim().optional(),
  country: z.string().trim().max(80).optional(),
  min_quantity: z.string().trim().optional(),
  valid_from: z.string().trim().optional(),
  valid_to: z.string().trim().optional(),
  priority: z.string().trim().optional(),
  note: z.string().trim().max(500).optional(),
});

export async function savePrice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('products.price.edit');

  const parsed = priceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const amount = numberOrNull(parsed.data.amount);
  if (amount === null || amount < 0) return { fieldErrors: { amount: 'Enter a non-negative amount' } };

  if (parsed.data.price_type === 'quantity_based' && numberOrNull(parsed.data.min_quantity) === null) {
    return { fieldErrors: { min_quantity: 'A quantity break needs a minimum quantity' } };
  }

  const supabase = await createServerSupabase();
  const { data: product } = await supabase
    .from('products')
    .select('id, company_id')
    .eq('id', parsed.data.product_id)
    .maybeSingle();

  if (!product) return { error: 'Product not found.' };

  const row = {
    company_id: product.company_id,
    product_id: product.id,
    variant_id: nullIfBlank(parsed.data.variant_id),
    price_type: parsed.data.price_type,
    amount,
    currency: parsed.data.currency.toUpperCase(),
    store_id: nullIfBlank(parsed.data.store_id),
    country: nullIfBlank(parsed.data.country),
    min_quantity: numberOrNull(parsed.data.min_quantity),
    valid_from: nullIfBlank(parsed.data.valid_from),
    valid_to: nullIfBlank(parsed.data.valid_to),
    priority: numberOrNull(parsed.data.priority) ?? 0,
    is_active: checkbox(formData, 'is_active'),
    note: nullIfBlank(parsed.data.note),
  };

  const id = String(formData.get('id') ?? '');

  const { error } = id
    ? await supabase.from('product_prices').update({ ...row, updated_by: session.profile.id }).eq('id', id)
    : await supabase.from('product_prices').insert({ ...row, created_by: session.profile.id });

  if (error) return describeDbError(error);

  // The trigger has already written the change to price_history (rule 15).
  revalidateCatalog(product.id);
  return { ok: true, message: id ? 'Price updated' : 'Price added' };
}

export async function deletePrice(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission('products.price.edit');

  const id = String(formData.get('id') ?? '');
  const productId = String(formData.get('product_id') ?? '');
  if (!id) return { error: 'Missing price id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('product_prices').delete().eq('id', id);
  if (error) return describeDbError(error);

  revalidateCatalog(productId);
  return { ok: true, message: 'Price removed' };
}

/* -------------------------------------------------------------------------- */
/* Cost components — §3.8                                                     */
/* -------------------------------------------------------------------------- */

const costSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().trim().optional(),
  component: z.enum(COST_COMPONENTS),
  amount: z.string().trim().min(1, 'Required'),
  currency: z.string().trim().length(3, 'Three-letter code'),
  effective_from: z.string().trim().optional(),
  effective_to: z.string().trim().optional(),
  note: z.string().trim().max(500).optional(),
});

export async function saveCost(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('products.cost.edit');

  const parsed = costSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const amount = numberOrNull(parsed.data.amount);
  if (amount === null || amount < 0) return { fieldErrors: { amount: 'Enter a non-negative amount' } };

  const supabase = await createServerSupabase();
  const { data: product } = await supabase
    .from('products')
    .select('id, company_id')
    .eq('id', parsed.data.product_id)
    .maybeSingle();

  if (!product) return { error: 'Product not found.' };

  const row = {
    company_id: product.company_id,
    product_id: product.id,
    variant_id: nullIfBlank(parsed.data.variant_id),
    component: parsed.data.component,
    amount,
    currency: parsed.data.currency.toUpperCase(),
    is_percentage: checkbox(formData, 'is_percentage'),
    effective_from: nullIfBlank(parsed.data.effective_from),
    effective_to: nullIfBlank(parsed.data.effective_to),
    note: nullIfBlank(parsed.data.note),
  };

  const id = String(formData.get('id') ?? '');

  const { error } = id
    ? await supabase.from('product_costs').update({ ...row, updated_by: session.profile.id }).eq('id', id)
    : await supabase.from('product_costs').insert({ ...row, created_by: session.profile.id });

  if (error) {
    return describeDbError(error, {
      uniqueMessage: 'This cost component already exists for that effective date.',
    });
  }

  revalidateCatalog(product.id);
  return { ok: true, message: id ? 'Cost updated' : 'Cost added' };
}

export async function deleteCost(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission('products.cost.edit');

  const id = String(formData.get('id') ?? '');
  const productId = String(formData.get('product_id') ?? '');
  if (!id) return { error: 'Missing cost id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('product_costs').delete().eq('id', id);
  if (error) return describeDbError(error);

  revalidateCatalog(productId);
  return { ok: true, message: 'Cost removed' };
}

/* -------------------------------------------------------------------------- */
/* Channel mapping — §3.5                                                     */
/* -------------------------------------------------------------------------- */

const mappingSchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().trim().optional(),
  store_id: z.string().uuid('Select a store'),
  external_product_id: z.string().trim().max(120).optional(),
  external_variant_id: z.string().trim().max(120).optional(),
  external_sku: z.string().trim().max(120).optional(),
  asin: z.string().trim().max(32).optional(),
  marketplace_fulfillment_sku: z.string().trim().max(120).optional(),
  external_url: z.string().trim().max(600).optional(),
  master_source: z.enum(['system', 'channel', 'bidirectional']),
  status: z.enum(['mapped', 'unmapped', 'conflict', 'error']),
});

export async function saveMapping(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('products.map');

  const parsed = mappingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();
  const { data: product } = await supabase
    .from('products')
    .select('id, company_id')
    .eq('id', parsed.data.product_id)
    .maybeSingle();

  if (!product) return { error: 'Product not found.' };

  // A mapping with no external identifier at all is not a mapping.
  const hasIdentifier = [
    parsed.data.external_variant_id,
    parsed.data.external_product_id,
    parsed.data.external_sku,
    parsed.data.asin,
    parsed.data.marketplace_fulfillment_sku,
  ].some((value) => nullIfBlank(value) !== null);

  if (parsed.data.status === 'mapped' && !hasIdentifier) {
    return {
      fieldErrors: { external_variant_id: 'Provide at least one channel identifier to mark this mapped.' },
    };
  }

  const row = {
    company_id: product.company_id,
    product_id: product.id,
    variant_id: nullIfBlank(parsed.data.variant_id),
    store_id: parsed.data.store_id,
    external_product_id: nullIfBlank(parsed.data.external_product_id),
    external_variant_id: nullIfBlank(parsed.data.external_variant_id),
    external_sku: nullIfBlank(parsed.data.external_sku),
    asin: nullIfBlank(parsed.data.asin),
    marketplace_fulfillment_sku: nullIfBlank(parsed.data.marketplace_fulfillment_sku),
    external_url: nullIfBlank(parsed.data.external_url),
    master_source: parsed.data.master_source,
    status: parsed.data.status,
  };

  const id = String(formData.get('id') ?? '');

  const { error } = id
    ? await supabase
        .from('product_channel_mappings')
        .update({ ...row, updated_by: session.profile.id })
        .eq('id', id)
    : await supabase
        .from('product_channel_mappings')
        .insert({ ...row, created_by: session.profile.id });

  if (error) {
    return describeDbError(error, {
      uniqueMessage: 'This variant is already mapped to that store.',
    });
  }

  revalidateCatalog(product.id);
  return { ok: true, message: id ? 'Mapping updated' : 'Mapping created' };
}

export async function deleteMapping(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission('products.map');

  const id = String(formData.get('id') ?? '');
  const productId = String(formData.get('product_id') ?? '');
  if (!id) return { error: 'Missing mapping id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('product_channel_mappings').delete().eq('id', id);
  if (error) return describeDbError(error);

  revalidateCatalog(productId);
  return { ok: true, message: 'Mapping removed' };
}

/* -------------------------------------------------------------------------- */
/* Bundles and kits — §3.9                                                    */
/* -------------------------------------------------------------------------- */

const componentSchema = z.object({
  bundle_product_id: z.string().uuid(),
  component_variant_id: z.string().uuid('Select a component'),
  quantity: z.string().trim().optional(),
  position: z.string().trim().optional(),
});

export async function addBundleComponent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission('products.bundles.manage');

  const parsed = componentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const quantity = numberOrNull(parsed.data.quantity) ?? 1;
  if (quantity <= 0) return { fieldErrors: { quantity: 'Must be greater than zero' } };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('bundle_components').insert({
    bundle_product_id: parsed.data.bundle_product_id,
    component_variant_id: parsed.data.component_variant_id,
    quantity,
    is_required: checkbox(formData, 'is_required'),
    position: numberOrNull(parsed.data.position) ?? 0,
  });

  if (error) {
    return describeDbError(error, {
      uniqueMessage: 'That component is already part of this bundle.',
    });
  }

  revalidateCatalog(parsed.data.bundle_product_id);
  return { ok: true, message: 'Component added' };
}

export async function removeBundleComponent(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission('products.bundles.manage');

  const id = String(formData.get('id') ?? '');
  const productId = String(formData.get('product_id') ?? '');
  if (!id) return { error: 'Missing component id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('bundle_components').delete().eq('id', id);
  if (error) return describeDbError(error);

  revalidateCatalog(productId);
  return { ok: true, message: 'Component removed' };
}

/* -------------------------------------------------------------------------- */
/* Collection membership — §3.6                                               */
/* -------------------------------------------------------------------------- */

export async function setProductCollections(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requirePermission('catalog.manage');

  const productId = String(formData.get('id') ?? '');
  if (!productId) return { error: 'Missing product id.' };

  const wanted = multi(formData, 'collections');
  const supabase = await createServerSupabase();

  const { data: existing, error: readError } = await supabase
    .from('product_collections')
    .select('collection_id')
    .eq('product_id', productId);

  if (readError) return describeDbError(readError);

  const current = new Set((existing ?? []).map((row) => row.collection_id));
  const target = new Set(wanted);

  const toAdd = wanted.filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !target.has(id));

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from('product_collections')
      .insert(toAdd.map((collectionId) => ({ collection_id: collectionId, product_id: productId })));
    if (error) return describeDbError(error);
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('product_collections')
      .delete()
      .eq('product_id', productId)
      .in('collection_id', toRemove);
    if (error) return describeDbError(error);
  }

  revalidateCatalog(productId);
  return { ok: true, message: 'Collections updated' };
}
