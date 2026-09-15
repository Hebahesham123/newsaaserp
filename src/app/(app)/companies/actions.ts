'use server';

import { z } from 'zod';
import { requirePermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { archiveRow, revalidateEntity } from '@/lib/actions';
import {
  describeDbError,
  fieldErrorsFrom,
  nullIfBlank,
  numberOrNull,
  type ActionState,
} from '@/lib/forms';

const COMPANY_STATUS = [
  'draft', 'under_review', 'active', 'suspended',
  'temporarily_blocked', 'subscription_expired', 'cancelled', 'archived',
] as const;

const OPERATING_MODEL = [
  'ecommerce_store_management', 'fulfillment', 'operations_only',
] as const;

const companySchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, hyphen and underscore only'),
  name_ar: z.string().trim().min(2, 'Required').max(200),
  name_en: z.string().trim().min(2, 'Required').max(200),
  trade_name: z.string().trim().max(200).optional(),
  business_type: z.string().trim().max(120).optional(),
  country: z.string().trim().max(80).optional(),
  region: z.string().trim().max(80).optional(),
  address: z.string().trim().max(400).optional(),
  email: z.string().trim().email('Not a valid email').optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional(),
  website: z.string().trim().max(200).optional(),
  tax_registration_number: z.string().trim().max(60).optional(),
  commercial_registration_number: z.string().trim().max(60).optional(),
  base_currency: z.string().trim().length(3, 'Three-letter code'),
  timezone: z.string().trim().max(60).optional(),
  default_locale: z.enum(['ar', 'en']),
  status: z.enum(COMPANY_STATUS),
  operating_model: z.enum(OPERATING_MODEL),
  subscription_plan: z.string().trim().max(60).optional(),
  subscription_start_date: z.string().trim().optional(),
  subscription_end_date: z.string().trim().optional(),
  max_users: z.string().trim().optional(),
  max_stores: z.string().trim().optional(),
  max_monthly_orders: z.string().trim().optional(),
  internal_notes: z.string().trim().max(2000).optional(),
});

/** Shapes the validated form into a row, dropping blanks to NULL. */
function toRow(values: z.infer<typeof companySchema>) {
  return {
    code: values.code,
    name_ar: values.name_ar,
    name_en: values.name_en,
    trade_name: nullIfBlank(values.trade_name),
    business_type: nullIfBlank(values.business_type),
    country: nullIfBlank(values.country),
    region: nullIfBlank(values.region),
    address: nullIfBlank(values.address),
    email: nullIfBlank(values.email),
    phone: nullIfBlank(values.phone),
    website: nullIfBlank(values.website),
    tax_registration_number: nullIfBlank(values.tax_registration_number),
    commercial_registration_number: nullIfBlank(values.commercial_registration_number),
    base_currency: values.base_currency.toUpperCase(),
    timezone: nullIfBlank(values.timezone) ?? 'Africa/Cairo',
    default_locale: values.default_locale,
    status: values.status,
    operating_model: values.operating_model,
    subscription_plan: nullIfBlank(values.subscription_plan),
    subscription_start_date: nullIfBlank(values.subscription_start_date),
    subscription_end_date: nullIfBlank(values.subscription_end_date),
    max_users: numberOrNull(values.max_users),
    max_stores: numberOrNull(values.max_stores),
    max_monthly_orders: numberOrNull(values.max_monthly_orders),
    internal_notes: nullIfBlank(values.internal_notes),
  };
}

export async function createCompany(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('companies.create');

  const parsed = companySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('companies')
    .insert({ ...toRow(parsed.data), created_by: session.profile.id })
    .select('id')
    .single();

  if (error) {
    return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This company code is already taken.' });
  }

  // The on_company_created trigger clones the 22 non-platform role templates
  // into the new company, so it is usable the moment it exists.
  revalidateEntity('/companies', data.id);
  return { ok: true, message: 'Company created' };
}

export async function updateCompany(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('companies.edit');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing company id.' };

  const parsed = companySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('companies')
    .update({ ...toRow(parsed.data), updated_by: session.profile.id })
    .eq('id', id);

  if (error) {
    return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This company code is already taken.' });
  }

  revalidateEntity('/companies', id);
  return { ok: true, message: 'Company updated' };
}

export async function archiveCompany(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('companies.archive');
  const id = String(formData.get('id') ?? '');
  const restore = formData.get('restore') != null;
  if (!id) return { error: 'Missing company id.' };

  const result = await archiveRow('companies', id, session, restore);
  if (result.ok) revalidateEntity('/companies', id);
  return result;
}
