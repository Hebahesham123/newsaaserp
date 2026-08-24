'use server';

import { z } from 'zod';
import { requirePermission } from '@/lib/auth/session';
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase/server';
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

const USER_STATUS = [
  'invited', 'activation_pending', 'active', 'on_leave',
  'temporarily_suspended', 'blocked', 'resigned', 'terminated', 'archived',
] as const;

const baseUser = {
  full_name: z.string().trim().min(2, 'Required').max(200),
  email: z.string().trim().email('Not a valid email'),
  phone: z.string().trim().max(40).optional(),
  employee_code: z.string().trim().max(32).optional(),
  job_title: z.string().trim().max(120).optional(),
  user_type: z.string().trim().max(40).optional(),
  department_id: z.string().trim().optional(),
  team_id: z.string().trim().optional(),
  manager_id: z.string().trim().optional(),
  merchant_id: z.string().trim().optional(),
  locale: z.enum(['ar', 'en']),
  timezone: z.string().trim().max(60).optional(),
  hire_date: z.string().trim().optional(),
  system_access_start_date: z.string().trim().optional(),
  max_assigned_orders: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
};

const inviteSchema = z.object(baseUser);
const updateSchema = z.object({ ...baseUser, status: z.enum(USER_STATUS) });

function toRow(values: z.infer<typeof inviteSchema>, formData: FormData) {
  return {
    full_name: values.full_name,
    email: values.email.toLowerCase(),
    phone: nullIfBlank(values.phone),
    employee_code: nullIfBlank(values.employee_code),
    job_title: nullIfBlank(values.job_title),
    user_type: nullIfBlank(values.user_type),
    department_id: nullIfBlank(values.department_id),
    team_id: nullIfBlank(values.team_id),
    manager_id: nullIfBlank(values.manager_id),
    merchant_id: nullIfBlank(values.merchant_id),
    locale: values.locale,
    timezone: nullIfBlank(values.timezone) ?? 'Africa/Cairo',
    hire_date: nullIfBlank(values.hire_date),
    system_access_start_date: nullIfBlank(values.system_access_start_date),
    max_assigned_orders: numberOrNull(values.max_assigned_orders),
    working_days: multi(formData, 'working_days')
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    notes: nullIfBlank(values.notes),
  };
}

/**
 * §2.5.1 — creates the app_users row an invited person will claim when they
 * sign up. The row is what makes their signup legal: `handle_new_auth_user`
 * rejects any email that has no pending invitation.
 */
export async function inviteUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('users.create');

  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const scope = await resolveCompanyId(session, formData);
  if ('error' in scope) return scope.error;

  const supabase = await createServerSupabase();
  const email = parsed.data.email.toLowerCase();

  // email is not unique in the schema, but two rows for one address would make
  // the invite claim ambiguous, so refuse it here.
  const { data: clash } = await supabase
    .from('app_users')
    .select('id')
    .ilike('email', email)
    .maybeSingle();

  if (clash) return { fieldErrors: { email: 'A user with this email already exists.' } };

  const { data, error } = await supabase
    .from('app_users')
    .insert({
      ...toRow(parsed.data, formData),
      company_id: scope.companyId,
      is_platform_admin: false,
      status: 'invited',
      created_by: session.profile.id,
    })
    .select('id')
    .single();

  if (error) {
    return describeDbError(error, {
      uniqueField: 'employee_code',
      uniqueMessage: 'This employee code is already used in this company.',
    });
  }

  const roleIds = multi(formData, 'roles');
  if (roleIds.length > 0) {
    const assigned = await applyRoles(data.id, roleIds, session.profile.id);
    if (assigned) return assigned;
  }

  revalidateEntity('/users', data.id);
  return { ok: true, message: 'User invited' };
}

export async function updateUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('users.edit');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing user id.' };

  const parsed = updateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('app_users')
    .update({
      ...toRow(parsed.data, formData),
      status: parsed.data.status,
      must_reset_password: checkbox(formData, 'must_reset_password'),
      updated_by: session.profile.id,
    })
    .eq('id', id);

  if (error) {
    return describeDbError(error, {
      uniqueField: 'employee_code',
      uniqueMessage: 'This employee code is already used in this company.',
    });
  }

  revalidateEntity('/users', id);
  return { ok: true, message: 'User updated' };
}

/** Replaces a user's role set. Requires the separate assign_roles permission. */
async function applyRoles(userId: string, roleIds: string[], actorId: string): Promise<ActionState | null> {
  const supabase = await createServerSupabase();

  const { data: existing, error: readError } = await supabase
    .from('user_roles')
    .select('role_id')
    .eq('user_id', userId);

  if (readError) return describeDbError(readError);

  const current = new Set((existing ?? []).map((row) => row.role_id));
  const target = new Set(roleIds);

  const toAdd = roleIds.filter((roleId) => !current.has(roleId));
  const toRemove = [...current].filter((roleId) => !target.has(roleId));

  if (toAdd.length > 0) {
    const { error } = await supabase
      .from('user_roles')
      .insert(toAdd.map((roleId) => ({ user_id: userId, role_id: roleId, assigned_by: actorId })));
    if (error) return describeDbError(error);
  }

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .in('role_id', toRemove);
    if (error) return describeDbError(error);
  }

  return null;
}

export async function assignRoles(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('users.assign_roles');

  const userId = String(formData.get('id') ?? '');
  if (!userId) return { error: 'Missing user id.' };

  const failure = await applyRoles(userId, multi(formData, 'roles'), session.profile.id);
  if (failure) return failure;

  revalidateEntity('/users', userId);
  return { ok: true, message: 'Roles updated' };
}

/** §2.5.4 — clears the lockout the failed-login counter applied. */
export async function clearLockout(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('users.edit');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing user id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('app_users')
    .update({ locked_until: null, failed_login_count: 0, updated_by: session.profile.id })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidateEntity('/users', id);
  return { ok: true, message: 'Lockout cleared' };
}

/**
 * Creates the Supabase auth account directly, so an administrator can hand over
 * a working password instead of waiting for the user to self-register.
 *
 * Uses the service role because creating auth users is not a client capability.
 * The app_users row must already exist and be invited — that is what keeps this
 * inside the tenant boundary rather than a way to mint arbitrary accounts.
 */
export async function createLoginAccount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission('users.create');

  const id = String(formData.get('id') ?? '');
  const password = String(formData.get('password') ?? '');

  if (!id) return { error: 'Missing user id.' };
  if (password.length < 10) {
    return { fieldErrors: { password: 'Use at least 10 characters.' } };
  }

  // Read through the caller's own client, so RLS confirms they may see this user.
  const supabase = await createServerSupabase();
  const { data: user } = await supabase
    .from('app_users')
    .select('id, email, full_name, status, auth_user_id')
    .eq('id', id)
    .maybeSingle();

  if (!user) return { error: 'User not found, or you do not have access to it.' };
  if (user.auth_user_id) return { error: 'This user already has a sign-in account.' };

  const admin = createAdminSupabase();
  const { error } = await admin.auth.admin.createUser({
    email: user.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: user.full_name },
  });

  if (error) return { error: error.message };

  // handle_new_auth_user claims the invited row and flips it to active, so
  // there is nothing to update here.
  revalidateEntity('/users', id);
  return { ok: true, message: `Sign-in account created for ${user.email}` };
}

export async function archiveUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('users.archive');
  const id = String(formData.get('id') ?? '');
  const restore = formData.get('restore') != null;
  if (!id) return { error: 'Missing user id.' };

  if (id === session.profile.id) {
    return { error: 'You cannot archive your own account.' };
  }

  const result = await archiveRow('app_users', id, session, restore);
  if (result.ok) revalidateEntity('/users', id);
  return result;
}
