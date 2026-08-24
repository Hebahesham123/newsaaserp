'use server';

import { z } from 'zod';
import { requirePermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { archiveRow, resolveCompanyId, revalidateEntity } from '@/lib/actions';
import type { MerchantService } from '@/lib/supabase/database.types';
import {
  describeDbError,
  fieldErrorsFrom,
  multi,
  nullIfBlank,
  numberOrNull,
  type ActionState,
} from '@/lib/forms';

const MERCHANT_STATUS = [
  'lead', 'contracting', 'onboarding', 'ready_for_go_live', 'active',
  'temporarily_suspended', 'payment_overdue', 'on_hold', 'contract_terminated', 'archived',
] as const;

const OPERATING_MODEL = [
  'own_store', 'multi_store', 'fulfillment_center', 'operations_only', 'marketplace',
] as const;

// Not exported: a 'use server' module may only export async functions.
const MERCHANT_SERVICES = [
  'order_management', 'order_confirmation', 'customer_service', 'warehousing',
  'goods_receiving', 'picking_packing', 'shipping', 'shipment_followup',
  'return_management', 'collection_management', 'marketplace_management',
  'product_management', 'inventory_management', 'affiliate_management',
  'reporting_only', 'full_operations',
] as const;

const merchantSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, hyphen and underscore only'),
  name: z.string().trim().min(2, 'Required').max(200),
  trade_name: z.string().trim().max(200).optional(),
  merchant_type: z.string().trim().max(120).optional(),
  contact_person: z.string().trim().max(120).optional(),
  email: z.string().trim().email('Not a valid email').optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional(),
  country: z.string().trim().max(80).optional(),
  address: z.string().trim().max(400).optional(),
  tax_registration_number: z.string().trim().max(60).optional(),
  commercial_registration_number: z.string().trim().max(60).optional(),
  currency: z.string().trim().length(3, 'Three-letter code'),
  status: z.enum(MERCHANT_STATUS),
  operating_model: z.enum(OPERATING_MODEL),
  contract_date: z.string().trim().optional(),
  go_live_date: z.string().trim().optional(),
  credit_limit: z.string().trim().optional(),
  payment_terms: z.string().trim().max(80).optional(),
  settlement_cycle: z.string().trim().max(40).optional(),
  commission_percentage: z.string().trim().optional(),
  internal_notes: z.string().trim().max(2000).optional(),
});

function toRow(values: z.infer<typeof merchantSchema>, services: string[]) {
  const commission = numberOrNull(values.commission_percentage);

  return {
    code: values.code,
    name: values.name,
    trade_name: nullIfBlank(values.trade_name),
    merchant_type: nullIfBlank(values.merchant_type),
    contact_person: nullIfBlank(values.contact_person),
    email: nullIfBlank(values.email),
    phone: nullIfBlank(values.phone),
    country: nullIfBlank(values.country),
    address: nullIfBlank(values.address),
    tax_registration_number: nullIfBlank(values.tax_registration_number),
    commercial_registration_number: nullIfBlank(values.commercial_registration_number),
    currency: values.currency.toUpperCase(),
    status: values.status,
    operating_model: values.operating_model,
    contract_date: nullIfBlank(values.contract_date),
    go_live_date: nullIfBlank(values.go_live_date),
    credit_limit: numberOrNull(values.credit_limit),
    payment_terms: nullIfBlank(values.payment_terms),
    settlement_cycle: nullIfBlank(values.settlement_cycle),
    commission_percentage: commission,
    services: services.filter((service): service is MerchantService =>
      (MERCHANT_SERVICES as readonly string[]).includes(service),
    ),
    internal_notes: nullIfBlank(values.internal_notes),
  };
}

/** Commission is a percentage; the column's CHECK enforces it, we explain it. */
function validateCommission(raw: string | undefined): string | null {
  const value = numberOrNull(raw);
  if (value === null) return null;
  return value < 0 || value > 100 ? 'Must be between 0 and 100' : null;
}

export async function createMerchant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('merchants.create');

  const parsed = merchantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const commissionError = validateCommission(parsed.data.commission_percentage);
  if (commissionError) return { fieldErrors: { commission_percentage: commissionError } };

  // §2.13 rule 3: a merchant cannot exist without a company.
  const scope = await resolveCompanyId(session, formData);
  if ('error' in scope) return scope.error;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('merchants')
    .insert({
      ...toRow(parsed.data, multi(formData, 'services')),
      company_id: scope.companyId,
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

  revalidateEntity('/merchants', data.id);
  return { ok: true, message: 'Merchant created' };
}

export async function updateMerchant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('merchants.edit');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing merchant id.' };

  const parsed = merchantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const commissionError = validateCommission(parsed.data.commission_percentage);
  if (commissionError) return { fieldErrors: { commission_percentage: commissionError } };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('merchants')
    .update({ ...toRow(parsed.data, multi(formData, 'services')), updated_by: session.profile.id })
    .eq('id', id);

  if (error) {
    return describeDbError(error, {
      uniqueField: 'code',
      uniqueMessage: 'This code is already used in this company.',
    });
  }

  revalidateEntity('/merchants', id);
  return { ok: true, message: 'Merchant updated' };
}

/** §2.3.2 fulfillment service pricing — drives §5.20 fees and §7.7 settlements. */
export async function updateMerchantPricing(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requirePermission('merchants.pricing.edit');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing merchant id.' };

  const keys = ['storage_per_cbm', 'receiving_per_unit', 'pick', 'pack', 'shipping', 'return_handling'];
  const pricing: Record<string, number> = {};
  for (const key of keys) {
    const value = numberOrNull(formData.get(key));
    if (value !== null) {
      if (value < 0) return { fieldErrors: { [key]: 'Cannot be negative' } };
      pricing[key] = value;
    }
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('merchants')
    .update({ service_pricing: pricing, updated_by: session.profile.id })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidateEntity('/merchants', id);
  return { ok: true, message: 'Service pricing updated' };
}

export async function archiveMerchant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('merchants.archive');
  const id = String(formData.get('id') ?? '');
  const restore = formData.get('restore') != null;
  if (!id) return { error: 'Missing merchant id.' };

  const result = await archiveRow('merchants', id, session, restore);
  if (result.ok) revalidateEntity('/merchants', id);
  return result;
}
