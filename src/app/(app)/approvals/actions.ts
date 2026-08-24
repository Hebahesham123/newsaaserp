'use server';

import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { describeDbError, nullIfBlank, type ActionState } from '@/lib/forms';

/**
 * §2.7.4 — records an approve/reject decision.
 *
 * The segregation-of-duties rule is a table constraint, not a check here: the
 * database refuses `decided_by = requested_by` outright. This action still
 * checks it first so the user gets an explanation rather than a raw
 * constraint violation.
 */
export async function decideApproval(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('approvals.decide');

  const id = String(formData.get('id') ?? '');
  const decision = String(formData.get('decision') ?? '');
  const note = nullIfBlank(formData.get('decision_note'));

  if (!id) return { error: 'Missing request id.' };
  if (decision !== 'approved' && decision !== 'rejected') {
    return { error: 'Decision must be approve or reject.' };
  }

  const supabase = await createServerSupabase();

  const { data: request } = await supabase
    .from('approval_requests')
    .select('id, status, requested_by')
    .eq('id', id)
    .maybeSingle();

  if (!request) return { error: 'Request not found.' };
  if (request.status !== 'pending') {
    return { error: 'This request has already been decided.' };
  }
  if (request.requested_by === session.profile.id) {
    return { error: 'You raised this request, so you cannot decide it (§2.7.4).' };
  }

  const { error } = await supabase
    .from('approval_requests')
    .update({
      status: decision,
      decided_by: session.profile.id,
      decided_at: new Date().toISOString(),
      decision_note: note,
    })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidatePath('/approvals');
  revalidatePath('/');
  return { ok: true, message: decision === 'approved' ? 'Request approved' : 'Request rejected' };
}
