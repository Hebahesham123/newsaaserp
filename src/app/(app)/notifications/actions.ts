'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { describeDbError, type ActionState } from '@/lib/forms';

/**
 * §2.10 — marks notifications read.
 *
 * No permission gate: the RLS policy already restricts both select and update
 * to `recipient_id = app.uid()`, so a user can only ever touch their own.
 */
export async function markNotificationRead(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireSession();

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing notification id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);

  if (error) return describeDbError(error);

  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Marked as read' };
}

export async function markAllNotificationsRead(): Promise<ActionState> {
  const session = await requireSession();

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', session.profile.id)
    .is('read_at', null);

  if (error) return describeDbError(error);

  revalidatePath('/notifications');
  revalidatePath('/', 'layout');
  return { ok: true, message: 'All notifications marked as read' };
}
