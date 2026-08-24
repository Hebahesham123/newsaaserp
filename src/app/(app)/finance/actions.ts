'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { describeDbError, nullIfBlank, type ActionState } from '@/lib/forms';

/**
 * §7 the finance actions that carry a rule the database enforces.
 *
 * Each of these deliberately does almost nothing but state an intent: the
 * segregation-of-duties check, the "calculated before approved" rule and the
 * approved-invoice lock all live in triggers, so the action's job is to let the
 * refusal through rather than to re-implement it.
 */

export async function approveExpense(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('finance.expenses.approve');

  const id = String(formData.get('id') ?? '');
  const reject = formData.get('reject') != null;
  if (!id) return { error: 'Missing expense id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('operating_expenses')
    .update({
      status: reject ? 'rejected' : 'approved',
      approved_by: reject ? null : session.profile.id,
      rejection_note: reject ? (nullIfBlank(formData.get('note')) ?? 'Rejected') : null,
      updated_by: session.profile.id,
    })
    .eq('id', id);

  // §2.7.4 self-approval comes back as a check_violation naming the rule.
  if (error) return describeDbError(error);

  revalidatePath('/expenses');
  return { ok: true, message: reject ? 'Expense rejected' : 'Expense approved' };
}

/** §7.7 rebuilds a statement from the period's orders, collections and costs. */
export async function calculateSettlement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission('finance.settlement.run');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing settlement id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('calculate_merchant_settlement', { p_settlement_id: id });
  if (error) return describeDbError(error);

  revalidatePath('/settlements');
  return { ok: true, message: 'Settlement recalculated' };
}

export async function approveSettlement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('finance.settlement.approve');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing settlement id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('merchant_settlements')
    .update({ status: 'approved', approved_by: session.profile.id, updated_by: session.profile.id })
    .eq('id', id);

  // §7.12 rule 2 surfaces here if the statement was never calculated.
  if (error) return describeDbError(error);

  revalidatePath('/settlements');
  return { ok: true, message: 'Settlement approved' };
}

export async function setInvoiceStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const status = String(formData.get('status') ?? '');

  // Approving and cancelling are different authorities; creating is neither.
  const session = await requirePermission(
    status === 'approved' ? 'finance.invoice.approve' : 'finance.invoice.create',
  );

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing invoice id.' };
  if (!['approved', 'paid', 'cancelled'].includes(status)) return { error: 'Unknown status.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('invoices')
    .update({
      status: status as 'approved' | 'paid' | 'cancelled',
      approved_by: status === 'approved' ? session.profile.id : undefined,
      cancellation_reason:
        status === 'cancelled' ? (nullIfBlank(formData.get('reason')) ?? 'Cancelled') : undefined,
      updated_by: session.profile.id,
    })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidatePath('/invoices');
  return { ok: true, message: `Invoice ${status}` };
}

/** §7.3 recompute the derived cost lines for one order. */
export async function rebuildOrderCosts(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission('finance.costs.edit');

  const orderId = String(formData.get('order_id') ?? '');
  if (!orderId) return { error: 'Missing order id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc('rebuild_order_costs', { p_order_id: orderId });
  if (error) return describeDbError(error);

  revalidatePath('/profitability');
  revalidatePath(`/orders/${orderId}`);
  return { ok: true, message: 'Costs rebuilt' };
}
