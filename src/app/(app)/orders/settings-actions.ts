'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { resolveCompanyId } from '@/lib/actions';
import {
  checkbox,
  describeDbError,
  fieldErrorsFrom,
  nullIfBlank,
  numberOrNull,
  type ActionState,
} from '@/lib/forms';

/**
 * Configurable reference data behind the Confirmation Center — cancellation
 * reasons (§4.11), the blacklist (§4.13), message templates (§4.9) and the
 * customer record itself (§4.8).
 *
 * They share a file because they share a lifecycle: each is company-scoped
 * configuration a manager edits, not transactional data an agent creates.
 */

const codeField = z
  .string()
  .trim()
  .min(2, 'At least 2 characters')
  .max(48)
  .regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dot, hyphen and underscore only');

/* -------------------------------------------------------------------------- */
/* Cancellation reasons — §4.11                                               */
/* -------------------------------------------------------------------------- */

const reasonSchema = z.object({
  code: codeField,
  name_en: z.string().trim().min(2, 'Required').max(200),
  name_ar: z.string().trim().min(2, 'Required').max(200),
  sort_order: z.string().trim().optional(),
});

export async function saveCancellationReason(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requirePermission('orders.reasons.manage');

  const parsed = reasonSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();
  const id = String(formData.get('id') ?? '');

  const row = {
    code: parsed.data.code,
    name_en: parsed.data.name_en,
    name_ar: parsed.data.name_ar,
    is_customer_fault: checkbox(formData, 'is_customer_fault'),
    requires_note: checkbox(formData, 'requires_note'),
    sort_order: numberOrNull(parsed.data.sort_order) ?? 0,
    is_active: checkbox(formData, 'is_active'),
  };

  if (id) {
    const { error } = await supabase.from('cancellation_reasons').update(row).eq('id', id);
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  } else {
    const scope = await resolveCompanyId(session, formData);
    if ('error' in scope) return scope.error;

    const { error } = await supabase
      .from('cancellation_reasons')
      .insert({ ...row, company_id: scope.companyId });
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  }

  revalidatePath('/cancellation-reasons');
  return { ok: true, message: id ? 'Reason updated' : 'Reason created' };
}

/* -------------------------------------------------------------------------- */
/* Blacklist — §4.13                                                          */
/* -------------------------------------------------------------------------- */

const blacklistSchema = z.object({
  scope: z.enum(['phone', 'address', 'email']),
  value: z.string().trim().min(3, 'Required').max(300),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
  expires_at: z.string().trim().optional(),
});

export async function saveBlacklistEntry(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requirePermission('orders.blacklist.manage');

  const parsed = blacklistSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();
  const id = String(formData.get('id') ?? '');

  // Emails and addresses are matched case-insensitively by the risk query, so
  // they are stored folded; a phone number is compared verbatim.
  const value =
    parsed.data.scope === 'phone' ? parsed.data.value : parsed.data.value.toLowerCase();

  const row = {
    scope: parsed.data.scope,
    value,
    reason: parsed.data.reason,
    expires_at: nullIfBlank(parsed.data.expires_at),
    is_active: checkbox(formData, 'is_active'),
  };

  if (id) {
    const { error } = await supabase
      .from('blacklist_entries')
      .update({ ...row, updated_by: session.profile.id })
      .eq('id', id);
    if (error) return describeDbError(error, { uniqueField: 'value', uniqueMessage: 'This value is already listed.' });
  } else {
    const scope = await resolveCompanyId(session, formData);
    if ('error' in scope) return scope.error;

    const { error } = await supabase
      .from('blacklist_entries')
      .insert({ ...row, company_id: scope.companyId, created_by: session.profile.id });
    if (error) return describeDbError(error, { uniqueField: 'value', uniqueMessage: 'This value is already listed.' });
  }

  revalidatePath('/blacklist');
  return { ok: true, message: id ? 'Entry updated' : 'Entry added' };
}

/**
 * §4.13 entries are deactivated rather than deleted: why a customer was blocked
 * and when the block was lifted is exactly the history a dispute needs.
 */
export async function setBlacklistActive(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requirePermission('orders.blacklist.manage');

  const id = String(formData.get('id') ?? '');
  const activate = formData.get('activate') != null;
  if (!id) return { error: 'Missing entry id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('blacklist_entries')
    .update({ is_active: activate, updated_by: session.profile.id })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidatePath('/blacklist');
  return { ok: true, message: activate ? 'Entry reactivated' : 'Entry lifted' };
}

/* -------------------------------------------------------------------------- */
/* Message templates — §4.9                                                   */
/* -------------------------------------------------------------------------- */

const templateSchema = z.object({
  code: codeField,
  name: z.string().trim().min(2, 'Required').max(160),
  channel: z.enum(['whatsapp', 'sms', 'email']),
  body_ar: z.string().trim().min(3, 'Required').max(4000),
  body_en: z.string().trim().min(3, 'Required').max(4000),
  variables: z.string().trim().max(600).optional(),
  sort_order: z.string().trim().optional(),
});

export async function saveMessageTemplate(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requirePermission('orders.templates.manage');

  const parsed = templateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();
  const id = String(formData.get('id') ?? '');

  const row = {
    code: parsed.data.code,
    name: parsed.data.name,
    channel: parsed.data.channel,
    body_ar: parsed.data.body_ar,
    body_en: parsed.data.body_en,
    variables: (parsed.data.variables ?? '')
      .split(/[,\n]/)
      .map((variable) => variable.trim().replace(/[{}]/g, ''))
      .filter(Boolean),
    sort_order: numberOrNull(parsed.data.sort_order) ?? 0,
    is_active: checkbox(formData, 'is_active'),
  };

  if (id) {
    const { error } = await supabase.from('message_templates').update(row).eq('id', id);
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  } else {
    const scope = await resolveCompanyId(session, formData);
    if ('error' in scope) return scope.error;

    const { error } = await supabase
      .from('message_templates')
      .insert({ ...row, company_id: scope.companyId });
    if (error) return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  }

  revalidatePath('/message-templates');
  return { ok: true, message: id ? 'Template updated' : 'Template created' };
}

/* -------------------------------------------------------------------------- */
/* Customers — §4.8                                                           */
/* -------------------------------------------------------------------------- */

const customerSchema = z.object({
  name: z.string().trim().min(2, 'Required').max(200),
  phone: z.string().trim().min(6, 'A valid mobile number is required').max(40),
  alt_phone: z.string().trim().max(40).optional(),
  email: z.string().trim().email('Not a valid email').optional().or(z.literal('')),
  governorate: z.string().trim().max(120).optional(),
  city: z.string().trim().max(120).optional(),
  address: z.string().trim().max(600).optional(),
  preferred_language: z.enum(['ar', 'en']),
  notes: z.string().trim().max(2000).optional(),
});

export async function saveCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.customer.edit');

  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();
  const id = String(formData.get('id') ?? '');

  const row = {
    name: parsed.data.name,
    phone: parsed.data.phone,
    alt_phone: nullIfBlank(parsed.data.alt_phone),
    email: nullIfBlank(parsed.data.email),
    governorate: nullIfBlank(parsed.data.governorate),
    city: nullIfBlank(parsed.data.city),
    address: nullIfBlank(parsed.data.address),
    preferred_language: parsed.data.preferred_language,
    notes: nullIfBlank(parsed.data.notes),
  };

  if (id) {
    const { error } = await supabase
      .from('customers')
      .update({ ...row, updated_by: session.profile.id })
      .eq('id', id);
    if (error) {
      return describeDbError(error, {
        uniqueField: 'phone',
        uniqueMessage: 'Another customer already uses this number.',
      });
    }
  } else {
    const scope = await resolveCompanyId(session, formData);
    if ('error' in scope) return scope.error;

    const { error } = await supabase
      .from('customers')
      .insert({ ...row, company_id: scope.companyId, created_by: session.profile.id });
    if (error) {
      return describeDbError(error, {
        uniqueField: 'phone',
        uniqueMessage: 'A customer with this number already exists.',
      });
    }
  }

  revalidatePath('/customers');
  if (id) revalidatePath(`/customers/${id}`);
  return { ok: true, message: id ? 'Customer updated' : 'Customer created' };
}
