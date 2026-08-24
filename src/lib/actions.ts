import 'server-only';

import { revalidatePath } from 'next/cache';
import type { Session } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import type { ActionState } from '@/lib/forms';

/**
 * Resolves which company a write belongs to.
 *
 * A company-scoped user has exactly one, and a submitted value is ignored — it
 * would be a cross-tenant write vector, and RLS would reject it anyway. A
 * platform admin has none, so they must choose, and the choice is validated
 * against the companies they can actually see.
 */
export async function resolveCompanyId(
  session: Session,
  formData: FormData,
): Promise<{ companyId: string } | { error: ActionState }> {
  if (session.profile.company_id) {
    return { companyId: session.profile.company_id };
  }

  const submitted = String(formData.get('company_id') ?? '').trim();
  if (!submitted) {
    return { error: { fieldErrors: { company_id: 'Select a company.' } } };
  }

  const supabase = await createServerSupabase();
  const { data } = await supabase.from('companies').select('id').eq('id', submitted).maybeSingle();

  if (!data) {
    return { error: { fieldErrors: { company_id: 'Company not found.' } } };
  }

  return { companyId: data.id };
}

/** Revalidates a list page and, when given, the detail page beneath it. */
export function revalidateEntity(list: string, id?: string | null) {
  revalidatePath(list);
  if (id) revalidatePath(`${list}/${id}`);
  // Dashboard counters read from these tables too.
  revalidatePath('/');
}

/**
 * Archive rather than delete — §2.13 rule 21 requires that a record with
 * history is never removed, and no table grants DELETE to a client role.
 */
export async function archiveRow(
  table:
    | 'companies' | 'merchants' | 'stores' | 'warehouses' | 'app_users'
    | 'departments' | 'teams' | 'shifts'
    | 'products' | 'brands' | 'categories' | 'suppliers',
  id: string,
  session: Session,
  restore = false,
): Promise<ActionState> {
  const supabase = await createServerSupabase();

  const { error } = await supabase
    .from(table)
    .update({
      archived_at: restore ? null : new Date().toISOString(),
      archived_by: restore ? null : session.profile.id,
      updated_by: session.profile.id,
    })
    .eq('id', id);

  if (error) return { error: error.message };
  return { ok: true, message: restore ? 'Restored' : 'Archived' };
}
