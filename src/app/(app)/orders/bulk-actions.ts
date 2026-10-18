'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission, can } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { describeDbError, type ActionState } from '@/lib/forms';
import type { OrderStatus } from '@/lib/supabase/database.types';

/**
 * §1 Order Selection & Bulk Actions.
 *
 * The brief asks for actions that depend on two things at once: what the user
 * is allowed to do, and what stage each selected order is actually in. Both
 * gates are applied per order rather than per selection, because a selection of
 * forty orders is rarely homogeneous — and the useful answer when half of them
 * cannot move is "these twenty did, these twenty did not, here is why", not a
 * blanket refusal.
 *
 * So nothing here fails the whole batch. Eligible orders are acted on, the rest
 * are counted with their reason, and the caller is told both.
 */

export type BulkActionKind = 'assign' | 'status' | 'tag' | 'archive';

/** Which statuses an order may be moved *to*, and what it must be in first. */
const STATUS_TRANSITIONS: Record<string, { from: OrderStatus[]; permission: string }> = {
  confirmed: {
    from: ['assigned', 'first_call', 'second_call', 'third_call', 'whatsapp_confirmation', 'callback'],
    permission: 'orders.confirm',
  },
  cancelled: {
    from: [
      'new', 'imported', 'pending_review', 'pending_assignment', 'assigned',
      'first_call', 'second_call', 'third_call', 'whatsapp_confirmation', 'callback',
    ],
    permission: 'orders.cancel',
  },
  ready_for_warehouse: {
    from: ['confirmed'],
    permission: 'orders.release',
  },
};

type Eligibility = { eligible: string[]; refused: { order: string; reason: string }[] };

/**
 * The shape every bulk action returns, so the UI can report both halves
 * without each action inventing its own wording.
 */
function describeOutcome(
  changed: number,
  refused: { order: string; reason: string }[],
): ActionState {
  if (changed === 0 && refused.length > 0) {
    const first = refused[0];
    return {
      error:
        refused.length === 1
          ? `${first.order}: ${first.reason}`
          : `No orders were eligible. ${first.order}: ${first.reason} (and ${refused.length - 1} more)`,
    };
  }

  if (refused.length > 0) {
    return {
      ok: true,
      message: `${changed} updated, ${refused.length} skipped — ${refused[0].reason}`,
    };
  }

  return { ok: true, message: `${changed} updated` };
}

function selectedIds(formData: FormData): string[] {
  return formData
    .getAll('orderId')
    .map((value) => String(value))
    .filter(Boolean);
}

/**
 * Moves a selection to a new status.
 *
 * The transition table is consulted per order. An order already in the target
 * status is skipped rather than refused — selecting "confirm" over a list that
 * includes three already-confirmed orders is a reasonable thing to do, and
 * treating it as an error would be pedantry.
 */
export async function bulkChangeStatus(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const target = String(formData.get('status') ?? '') as OrderStatus;
  const transition = STATUS_TRANSITIONS[target];

  if (!transition) return { error: 'That status cannot be set in bulk.' };

  const session = await requirePermission(transition.permission);
  const ids = selectedIds(formData);
  if (ids.length === 0) return { error: 'Select at least one order.' };

  const supabase = await createServerSupabase();

  const { data: orders, error: readError } = await supabase
    .from('orders')
    .select('id, order_number, status')
    .in('id', ids);

  if (readError) return describeDbError(readError);

  const { eligible, refused }: Eligibility = { eligible: [], refused: [] };

  for (const order of orders ?? []) {
    if (order.status === target) continue;

    if (!transition.from.includes(order.status)) {
      refused.push({
        order: order.order_number,
        reason: `cannot move from ${order.status.replace(/_/g, ' ')}`,
      });
      continue;
    }

    eligible.push(order.id);
  }

  if (eligible.length === 0) return describeOutcome(0, refused);

  // Written one by one rather than as a single `in` update: the order triggers
  // enforce their own rules per row, and a batch that trips one of them would
  // roll back the rows that were fine.
  let changed = 0;
  for (const id of eligible) {
    const { error } = await supabase
      .from('orders')
      .update({ status: target, updated_by: session.profile.id })
      .eq('id', id);

    if (error) {
      const order = (orders ?? []).find((row) => row.id === id);
      refused.push({ order: order?.order_number ?? id, reason: error.message });
    } else {
      changed += 1;
    }
  }

  revalidatePath('/orders');
  return describeOutcome(changed, refused);
}

/** Assigns a selection to one user. */
export async function bulkAssign(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.assign');
  const assignee = String(formData.get('assigned_to') ?? '');
  const ids = selectedIds(formData);

  if (!assignee) return { error: 'Choose someone to assign to.' };
  if (ids.length === 0) return { error: 'Select at least one order.' };

  const supabase = await createServerSupabase();

  const { data: orders, error: readError } = await supabase
    .from('orders')
    .select('id, order_number, status')
    .in('id', ids);

  if (readError) return describeDbError(readError);

  const refused: { order: string; reason: string }[] = [];
  const eligible: string[] = [];

  for (const order of orders ?? []) {
    // A finished order has nobody left to assign it to.
    if (order.status === 'cancelled' || order.status === 'ready_for_warehouse') {
      refused.push({ order: order.order_number, reason: 'already left confirmation' });
      continue;
    }
    eligible.push(order.id);
  }

  if (eligible.length === 0) return describeOutcome(0, refused);

  const { error } = await supabase
    .from('orders')
    .update({
      assigned_to: assignee,
      assigned_at: new Date().toISOString(),
      assigned_by: session.profile.id,
      assignment_method: 'manual',
      updated_by: session.profile.id,
    })
    .in('id', eligible);

  if (error) return describeDbError(error);

  revalidatePath('/orders');
  return describeOutcome(eligible.length, refused);
}

/**
 * Adds one tag to a selection.
 *
 * Read-modify-write per order because the column is an array and a tag must be
 * appended to whatever is already there, not replace it.
 */
export async function bulkAddTag(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.edit');
  const tag = String(formData.get('tag') ?? '').trim();
  const ids = selectedIds(formData);

  if (!tag) return { error: 'Enter a tag.' };
  if (ids.length === 0) return { error: 'Select at least one order.' };

  const supabase = await createServerSupabase();

  const { data: orders, error: readError } = await supabase
    .from('orders')
    .select('id, order_number, tags')
    .in('id', ids);

  if (readError) return describeDbError(readError);

  let changed = 0;
  const refused: { order: string; reason: string }[] = [];

  for (const order of orders ?? []) {
    const tags = (order.tags ?? []) as string[];
    if (tags.includes(tag)) continue;

    const { error } = await supabase
      .from('orders')
      .update({ tags: [...tags, tag], updated_by: session.profile.id })
      .eq('id', order.id);

    if (error) refused.push({ order: order.order_number, reason: error.message });
    else changed += 1;
  }

  revalidatePath('/orders');
  return describeOutcome(changed, refused);
}

/** Archives a selection. Orders already in the warehouse stay put. */
export async function bulkArchive(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('orders.archive');
  const ids = selectedIds(formData);
  if (ids.length === 0) return { error: 'Select at least one order.' };

  const supabase = await createServerSupabase();

  const { data: orders, error: readError } = await supabase
    .from('orders')
    .select('id, order_number, status, archived_at')
    .in('id', ids);

  if (readError) return describeDbError(readError);

  const refused: { order: string; reason: string }[] = [];
  const eligible: string[] = [];

  for (const order of orders ?? []) {
    if (order.archived_at) continue;
    if (order.status === 'ready_for_warehouse') {
      refused.push({ order: order.order_number, reason: 'already released to the warehouse' });
      continue;
    }
    eligible.push(order.id);
  }

  if (eligible.length === 0) return describeOutcome(0, refused);

  const { error } = await supabase
    .from('orders')
    .update({
      archived_at: new Date().toISOString(),
      archived_by: session.profile.id,
    })
    .in('id', eligible);

  if (error) return describeDbError(error);

  revalidatePath('/orders');
  return describeOutcome(eligible.length, refused);
}

/**
 * Which bulk actions to offer this viewer.
 *
 * Computed on the server so an action the role forbids is never rendered —
 * the brief asks that the menu itself be permission-aware, not merely that the
 * handler refuse afterwards.
 */
export async function availableBulkActions(): Promise<
  { kind: BulkActionKind; value?: string; permission: string }[]
> {
  const { getSession } = await import('@/lib/auth/session');
  const session = await getSession();
  if (!session) return [];

  const all: { kind: BulkActionKind; value?: string; permission: string }[] = [
    { kind: 'assign', permission: 'orders.assign' },
    { kind: 'status', value: 'confirmed', permission: 'orders.confirm' },
    { kind: 'status', value: 'cancelled', permission: 'orders.cancel' },
    { kind: 'status', value: 'ready_for_warehouse', permission: 'orders.release' },
    { kind: 'tag', permission: 'orders.edit' },
    { kind: 'archive', permission: 'orders.archive' },
  ];

  return all.filter((action) => can(session, action.permission));
}

/**
 * One entry point for the bulk bar.
 *
 * The UI is a single form with one dropdown, so it submits one action and names
 * the operation in a field rather than pointing at a different server function
 * per button. That keeps the result — which is a two-part report, not a
 * success flag — flowing back through one `useActionState`.
 */
export async function runBulkAction(
  prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const op = String(formData.get('op') ?? '');

  switch (op) {
    case 'assign':
      return bulkAssign(prev, formData);
    case 'tag':
      return bulkAddTag(prev, formData);
    case 'archive':
      return bulkArchive(prev, formData);
    case 'confirmed':
    case 'cancelled':
    case 'ready_for_warehouse':
      formData.set('status', op);
      return bulkChangeStatus(prev, formData);
    default:
      return { error: 'Choose an action.' };
  }
}
