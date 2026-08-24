'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { archiveRow, resolveCompanyId } from '@/lib/actions';
import {
  checkbox,
  describeDbError,
  fieldErrorsFrom,
  nullIfBlank,
  numberOrNull,
  type ActionState,
} from '@/lib/forms';

/**
 * §3.6 Catalog Management — brands, categories, collections, units of measure
 * and the attribute axes variants are built from. All five sit behind the one
 * `catalog.manage` permission, since they are the same job.
 */

function revalidateCatalog() {
  revalidatePath('/catalog');
  revalidatePath('/products');
}

const codeField = z
  .string()
  .trim()
  .min(2, 'At least 2 characters')
  .max(48)
  .regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dot, hyphen and underscore only');

/* -------------------------------------------------------------------------- */
/* Brands                                                                     */
/* -------------------------------------------------------------------------- */

const brandSchema = z.object({
  code: codeField,
  name_en: z.string().trim().min(2, 'Required').max(200),
  name_ar: z.string().trim().min(2, 'Required').max(200),
  merchant_id: z.string().trim().optional(),
  logo_url: z.string().trim().max(600).optional(),
  description: z.string().trim().max(1000).optional(),
});

export async function saveBrand(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('catalog.manage');

  const parsed = brandSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const id = String(formData.get('id') ?? '');
  const supabase = await createServerSupabase();

  const row = {
    code: parsed.data.code,
    name_en: parsed.data.name_en,
    name_ar: parsed.data.name_ar,
    merchant_id: nullIfBlank(parsed.data.merchant_id),
    logo_url: nullIfBlank(parsed.data.logo_url),
    description: nullIfBlank(parsed.data.description),
    is_active: checkbox(formData, 'is_active'),
  };

  if (id) {
    const { error } = await supabase
      .from('brands')
      .update({ ...row, updated_by: session.profile.id })
      .eq('id', id);
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  } else {
    const scope = await resolveCompanyId(session, formData);
    if ('error' in scope) return scope.error;

    const { error } = await supabase
      .from('brands')
      .insert({ ...row, company_id: scope.companyId, created_by: session.profile.id });
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  }

  revalidateCatalog();
  return { ok: true, message: id ? 'Brand updated' : 'Brand created' };
}

export async function archiveBrand(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('catalog.manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing brand id.' };

  const result = await archiveRow('brands', id, session, formData.get('restore') != null);
  if (result.ok) revalidateCatalog();
  return result;
}

/* -------------------------------------------------------------------------- */
/* Categories — self-referencing, so main and sub live in one table            */
/* -------------------------------------------------------------------------- */

const categorySchema = z.object({
  code: codeField,
  name_en: z.string().trim().min(2, 'Required').max(200),
  name_ar: z.string().trim().min(2, 'Required').max(200),
  parent_id: z.string().trim().optional(),
  description: z.string().trim().max(1000).optional(),
  sort_order: z.string().trim().optional(),
});

export async function saveCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('catalog.manage');

  const parsed = categorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const id = String(formData.get('id') ?? '');
  const parentId = nullIfBlank(parsed.data.parent_id);

  // A category cannot be its own parent; the DB has the same check, this
  // explains it before the round trip.
  if (id && parentId === id) {
    return { fieldErrors: { parent_id: 'A category cannot be its own parent.' } };
  }

  const supabase = await createServerSupabase();

  const row = {
    code: parsed.data.code,
    name_en: parsed.data.name_en,
    name_ar: parsed.data.name_ar,
    parent_id: parentId,
    description: nullIfBlank(parsed.data.description),
    sort_order: numberOrNull(parsed.data.sort_order) ?? 0,
    is_active: checkbox(formData, 'is_active'),
  };

  if (id) {
    const { error } = await supabase
      .from('categories')
      .update({ ...row, updated_by: session.profile.id })
      .eq('id', id);
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  } else {
    const scope = await resolveCompanyId(session, formData);
    if ('error' in scope) return scope.error;

    const { error } = await supabase
      .from('categories')
      .insert({ ...row, company_id: scope.companyId, created_by: session.profile.id });
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  }

  revalidateCatalog();
  return { ok: true, message: id ? 'Category updated' : 'Category created' };
}

export async function archiveCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('catalog.manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing category id.' };

  const result = await archiveRow('categories', id, session, formData.get('restore') != null);
  if (result.ok) revalidateCatalog();
  return result;
}

/* -------------------------------------------------------------------------- */
/* Collections                                                                */
/* -------------------------------------------------------------------------- */

const collectionSchema = z.object({
  code: codeField,
  name_en: z.string().trim().min(2, 'Required').max(200),
  name_ar: z.string().trim().min(2, 'Required').max(200),
  merchant_id: z.string().trim().optional(),
  description: z.string().trim().max(1000).optional(),
  season_start: z.string().trim().optional(),
  season_end: z.string().trim().optional(),
});

export async function saveCollection(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('catalog.manage');

  const parsed = collectionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const id = String(formData.get('id') ?? '');
  const supabase = await createServerSupabase();

  const row = {
    code: parsed.data.code,
    name_en: parsed.data.name_en,
    name_ar: parsed.data.name_ar,
    merchant_id: nullIfBlank(parsed.data.merchant_id),
    description: nullIfBlank(parsed.data.description),
    is_seasonal: checkbox(formData, 'is_seasonal'),
    season_start: nullIfBlank(parsed.data.season_start),
    season_end: nullIfBlank(parsed.data.season_end),
    is_active: checkbox(formData, 'is_active'),
  };

  if (id) {
    const { error } = await supabase
      .from('collections')
      .update({ ...row, updated_by: session.profile.id })
      .eq('id', id);
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  } else {
    const scope = await resolveCompanyId(session, formData);
    if ('error' in scope) return scope.error;

    const { error } = await supabase
      .from('collections')
      .insert({ ...row, company_id: scope.companyId, created_by: session.profile.id });
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  }

  revalidateCatalog();
  return { ok: true, message: id ? 'Collection updated' : 'Collection created' };
}

/* -------------------------------------------------------------------------- */
/* Units of measure                                                           */
/* -------------------------------------------------------------------------- */

const unitSchema = z.object({
  code: codeField,
  name_en: z.string().trim().min(1, 'Required').max(80),
  name_ar: z.string().trim().min(1, 'Required').max(80),
});

export async function saveUnit(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('catalog.manage');

  const parsed = unitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const id = String(formData.get('id') ?? '');
  const supabase = await createServerSupabase();

  const row = {
    code: parsed.data.code,
    name_en: parsed.data.name_en,
    name_ar: parsed.data.name_ar,
    allows_fractions: checkbox(formData, 'allows_fractions'),
    is_active: checkbox(formData, 'is_active'),
  };

  if (id) {
    const { error } = await supabase.from('units_of_measure').update(row).eq('id', id);
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  } else {
    const scope = await resolveCompanyId(session, formData);
    if ('error' in scope) return scope.error;

    const { error } = await supabase
      .from('units_of_measure')
      .insert({ ...row, company_id: scope.companyId });
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  }

  revalidateCatalog();
  return { ok: true, message: id ? 'Unit updated' : 'Unit created' };
}

/* -------------------------------------------------------------------------- */
/* Attributes — the variant axes (§3.4, §3.6)                                 */
/* -------------------------------------------------------------------------- */

const attributeSchema = z.object({
  code: codeField,
  name_en: z.string().trim().min(1, 'Required').max(80),
  name_ar: z.string().trim().min(1, 'Required').max(80),
  values: z.string().trim().max(2000).optional(),
  sort_order: z.string().trim().optional(),
});

export async function saveAttribute(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('catalog.manage');

  const parsed = attributeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const id = String(formData.get('id') ?? '');
  const supabase = await createServerSupabase();

  const row = {
    code: parsed.data.code,
    name_en: parsed.data.name_en,
    name_ar: parsed.data.name_ar,
    // Comma or newline separated; an empty list means free text.
    values: (parsed.data.values ?? '')
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean),
    is_variant_axis: checkbox(formData, 'is_variant_axis'),
    sort_order: numberOrNull(parsed.data.sort_order) ?? 0,
  };

  if (id) {
    const { error } = await supabase.from('product_attributes').update(row).eq('id', id);
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  } else {
    const scope = await resolveCompanyId(session, formData);
    if ('error' in scope) return scope.error;

    const { error } = await supabase
      .from('product_attributes')
      .insert({ ...row, company_id: scope.companyId });
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  }

  revalidateCatalog();
  return { ok: true, message: id ? 'Attribute updated' : 'Attribute created' };
}

/* -------------------------------------------------------------------------- */
/* Suppliers — §3.6, behind their own permission pair                         */
/* -------------------------------------------------------------------------- */

const supplierSchema = z.object({
  code: codeField,
  name: z.string().trim().min(2, 'Required').max(200),
  merchant_id: z.string().trim().optional(),
  contact_person: z.string().trim().max(120).optional(),
  email: z.string().trim().email('Not a valid email').optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional(),
  country: z.string().trim().max(80).optional(),
  address: z.string().trim().max(400).optional(),
  payment_terms: z.string().trim().max(80).optional(),
  lead_time_days: z.string().trim().optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function saveSupplier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('suppliers.manage');

  const parsed = supplierSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const leadTime = numberOrNull(parsed.data.lead_time_days);
  if (leadTime !== null && leadTime < 0) {
    return { fieldErrors: { lead_time_days: 'Cannot be negative' } };
  }

  const id = String(formData.get('id') ?? '');
  const supabase = await createServerSupabase();

  const row = {
    code: parsed.data.code,
    name: parsed.data.name,
    merchant_id: nullIfBlank(parsed.data.merchant_id),
    contact_person: nullIfBlank(parsed.data.contact_person),
    email: nullIfBlank(parsed.data.email),
    phone: nullIfBlank(parsed.data.phone),
    country: nullIfBlank(parsed.data.country),
    address: nullIfBlank(parsed.data.address),
    payment_terms: nullIfBlank(parsed.data.payment_terms),
    lead_time_days: leadTime,
    notes: nullIfBlank(parsed.data.notes),
    is_active: checkbox(formData, 'is_active'),
  };

  if (id) {
    const { error } = await supabase
      .from('suppliers')
      .update({ ...row, updated_by: session.profile.id })
      .eq('id', id);
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  } else {
    const scope = await resolveCompanyId(session, formData);
    if ('error' in scope) return scope.error;

    const { error } = await supabase
      .from('suppliers')
      .insert({ ...row, company_id: scope.companyId, created_by: session.profile.id });
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  }

  revalidatePath('/suppliers');
  revalidateCatalog();
  return { ok: true, message: id ? 'Supplier updated' : 'Supplier created' };
}

export async function archiveSupplier(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('suppliers.manage');
  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing supplier id.' };

  const result = await archiveRow('suppliers', id, session, formData.get('restore') != null);
  if (result.ok) {
    revalidatePath('/suppliers');
    revalidateCatalog();
  }
  return result;
}
