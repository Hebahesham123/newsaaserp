'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';

const merchantSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'Code may contain letters, digits, hyphen and underscore only'),
  name: z.string().trim().min(2).max(200),
  trade_name: z.string().trim().max(200).optional().or(z.literal('')),
  email: z.string().trim().email().optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  country: z.string().trim().max(80).optional().or(z.literal('')),
  currency: z.string().trim().length(3).default('EGP'),
  operating_model: z.enum(['own_store', 'multi_store', 'fulfillment_center', 'operations_only', 'marketplace']),
  status: z.enum([
    'lead', 'contracting', 'onboarding', 'ready_for_go_live', 'active',
    'temporarily_suspended', 'payment_overdue', 'on_hold', 'contract_terminated', 'archived',
  ]),
  settlement_cycle: z.string().trim().max(40).optional().or(z.literal('')),
  commission_percentage: z.coerce.number().min(0).max(100).optional(),
});

export type MerchantFormState = {
  error?: string;
  fieldErrors?: Record<string, string>;
};

export async function createMerchant(
  _prev: MerchantFormState,
  formData: FormData,
): Promise<MerchantFormState> {
  const session = await requirePermission('merchants.create');

  const parsed = merchantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] = issue.message;
    }
    return { fieldErrors };
  }

  // §2.13 rule 3: a merchant cannot exist without a company. A platform admin
  // has no implicit company, so they must create merchants from a company page.
  const companyId = session.profile.company_id;
  if (!companyId) {
    return { error: 'Select a company before creating a merchant.' };
  }

  const values = parsed.data;
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from('merchants')
    .insert({
      company_id: companyId,
      code: values.code,
      name: values.name,
      trade_name: values.trade_name || null,
      email: values.email || null,
      phone: values.phone || null,
      country: values.country || null,
      currency: values.currency.toUpperCase(),
      operating_model: values.operating_model,
      status: values.status,
      settlement_cycle: values.settlement_cycle || null,
      commission_percentage: values.commission_percentage ?? null,
      created_by: session.profile.id,
    })
    .select('id')
    .single();

  if (error) {
    // 23505 = unique_violation, i.e. the code is taken within this company (§2.13 rule 9).
    if (error.code === '23505') {
      return { fieldErrors: { code: 'This code is already used in your company.' } };
    }
    return { error: error.message };
  }

  revalidatePath('/merchants');
  redirect(`/merchants/${data.id}`);
}
