'use server';

import { z } from 'zod';
import { requirePermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { archiveRow, resolveCompanyId, revalidateEntity } from '@/lib/actions';
import {
  checkbox,
  describeDbError,
  fieldErrorsFrom,
  multi,
  nullIfBlank,
  numberOrNull,
  type ActionState,
} from '@/lib/forms';

const teamSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, hyphen and underscore only'),
  name: z.string().trim().min(2, 'Required').max(200),
  department_id: z.string().trim().optional(),
  leader_id: z.string().trim().optional(),
  shift_id: z.string().trim().optional(),
  max_workload_capacity: z.string().trim().optional(),
  assigned_regions: z.string().trim().max(400).optional(),
  order_types: z.string().trim().max(400).optional(),
});

/** Free-text list fields accept commas or new lines. */
function list(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toRow(values: z.infer<typeof teamSchema>, formData: FormData) {
  return {
    code: values.code,
    name: values.name,
    department_id: nullIfBlank(values.department_id),
    leader_id: nullIfBlank(values.leader_id),
    shift_id: nullIfBlank(values.shift_id),
    max_workload_capacity: numberOrNull(values.max_workload_capacity),
    // §4.6 routing dimensions — consumed by smart order assignment.
    assigned_store_ids: multi(formData, 'assigned_store_ids'),
    assigned_merchant_ids: multi(formData, 'assigned_merchant_ids'),
    assigned_regions: list(values.assigned_regions),
    order_types: list(values.order_types),
    is_active: checkbox(formData, 'is_active'),
  };
}

export async function createTeam(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('teams.manage');

  const parsed = teamSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const capacity = numberOrNull(parsed.data.max_workload_capacity);
  if (capacity !== null && capacity <= 0) {
    return { fieldErrors: { max_workload_capacity: 'Must be greater than zero' } };
  }

  const scope = await resolveCompanyId(session, formData);
  if ('error' in scope) return scope.error;

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('teams').insert({
    ...toRow(parsed.data, formData),
    company_id: scope.companyId,
    created_by: session.profile.id,
  });

  if (error) {
    return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  }

  revalidateEntity('/teams');
  return { ok: true, message: 'Team created' };
}

export async function updateTeam(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('teams.manage');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing team id.' };

  const parsed = teamSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const capacity = numberOrNull(parsed.data.max_workload_capacity);
  if (capacity !== null && capacity <= 0) {
    return { fieldErrors: { max_workload_capacity: 'Must be greater than zero' } };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('teams')
    .update({ ...toRow(parsed.data, formData), updated_by: session.profile.id })
    .eq('id', id);

  if (error) {
    return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  }

  revalidateEntity('/teams');
  return { ok: true, message: 'Team updated' };
}

/** §2.8.2 membership. Replaces the whole member set in one transaction-ish pass. */
export async function setTeamMembers(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission('teams.manage');

  const teamId = String(formData.get('id') ?? '');
  if (!teamId) return { error: 'Missing team id.' };

  const wanted = multi(formData, 'members');
  const supabase = await createServerSupabase();

  const { data: existing, error: readError } = await supabase
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId);

  if (readError) return describeDbError(readError);

  const current = new Set((existing ?? []).map((row) => row.user_id));
  const target = new Set(wanted);

  const toAdd = wanted.filter((id) => !current.has(id));
  const toRemove = [...current].filter((id) => !target.has(id));

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from('team_members')
      .insert(toAdd.map((userId) => ({ team_id: teamId, user_id: userId })));
    if (error) return describeDbError(error);
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('team_members')
      .delete()
      .eq('team_id', teamId)
      .in('user_id', toRemove);
    if (error) return describeDbError(error);
  }

  revalidateEntity('/teams');
  return { ok: true, message: `Members updated (${target.size})` };
}

export async function archiveTeam(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('teams.manage');
  const id = String(formData.get('id') ?? '');
  const restore = formData.get('restore') != null;
  if (!id) return { error: 'Missing team id.' };

  const result = await archiveRow('teams', id, session, restore);
  if (result.ok) revalidateEntity('/teams');
  return result;
}
