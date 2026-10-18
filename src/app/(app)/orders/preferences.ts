'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { describeDbError, type ActionState } from '@/lib/forms';
import { allowedOrderColumns } from '@/lib/orders/columns';

/**
 * §6 Customize Columns — the preference half.
 *
 * Saved against the person, not the company, and never named: this is simply
 * how they last left the table. Named arrangements are Saved Views (§8), which
 * is a different feature with a different lifetime.
 *
 * The submitted list is intersected with what the viewer is actually allowed to
 * see before it is stored. A hand-made request could otherwise persist a column
 * the role forbids, and it would then be honoured on every later render —
 * permission checks have to happen on the way in as well as on the way out.
 */
export async function saveColumnPreference(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();

  const allowed = new Set(allowedOrderColumns(session).map((column) => column.key));
  const columns = formData
    .getAll('column')
    .map((value) => String(value))
    .filter((key) => allowed.has(key as never));

  const supabase = await createServerSupabase();

  const { error } = await supabase.from('user_table_preferences').upsert(
    {
      company_id: session.profile.company_id,
      user_id: session.profile.id,
      screen: 'orders',
      columns,
    },
    { onConflict: 'user_id,screen' },
  );

  if (error) return describeDbError(error);

  revalidatePath('/orders');
  return { ok: true, message: 'Columns saved' };
}

/** Clears the preference, so the screen falls back to its defaults. */
export async function resetColumnPreference(): Promise<ActionState> {
  const session = await requireSession();
  const supabase = await createServerSupabase();

  const { error } = await supabase
    .from('user_table_preferences')
    .delete()
    .eq('user_id', session.profile.id)
    .eq('screen', 'orders');

  if (error) return describeDbError(error);

  revalidatePath('/orders');
  return { ok: true, message: 'Columns reset' };
}
