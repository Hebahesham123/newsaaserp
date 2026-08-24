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
  type ActionState,
} from '@/lib/forms';

const roleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(48)
    .regex(/^[a-z0-9_]+$/, 'Lower-case letters, digits and underscore only'),
  name_en: z.string().trim().min(2, 'Required').max(120),
  name_ar: z.string().trim().min(2, 'Required').max(120),
  description: z.string().trim().max(500).optional(),
});

function revalidateRoles() {
  revalidatePath('/roles');
  revalidatePath('/roles/matrix');
  revalidatePath('/users');
}

export async function createRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('roles.manage');

  const parsed = roleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  // A client may only create company roles. Templates (company_id IS NULL) are
  // platform reference data, cloned into companies by provisioning.
  const scope = await resolveCompanyId(session, formData);
  if ('error' in scope) return scope.error;

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('roles').insert({
    company_id: scope.companyId,
    code: parsed.data.code,
    name_en: parsed.data.name_en,
    name_ar: parsed.data.name_ar,
    description: nullIfBlank(parsed.data.description),
    is_system_template: false,
    is_active: true,
    created_by: session.profile.id,
  });

  if (error) {
    return describeDbError(error, {
      uniqueField: 'code',
      uniqueMessage: 'A role with this code already exists in this company.',
    });
  }

  revalidateRoles();
  return { ok: true, message: 'Role created' };
}

export async function updateRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('roles.manage');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing role id.' };

  const parsed = roleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();

  const { data: role } = await supabase
    .from('roles')
    .select('id, company_id, is_system_template')
    .eq('id', id)
    .maybeSingle();

  if (!role) return { error: 'Role not found.' };
  if (role.company_id === null) {
    return { error: 'System templates are read-only. Edit the company copy instead.' };
  }

  const { error } = await supabase
    .from('roles')
    .update({
      code: parsed.data.code,
      name_en: parsed.data.name_en,
      name_ar: parsed.data.name_ar,
      description: nullIfBlank(parsed.data.description),
      is_active: checkbox(formData, 'is_active'),
      updated_by: session.profile.id,
    })
    .eq('id', id);

  if (error) {
    return describeDbError(error, {
      uniqueField: 'code',
      uniqueMessage: 'A role with this code already exists in this company.',
    });
  }

  revalidateRoles();
  return { ok: true, message: 'Role updated' };
}

/**
 * §2.7.1 — grants or revokes one permission on one role.
 *
 * A cell in the matrix, not a form: the write is a single row insert or delete,
 * and role_permissions has its own audit trigger that records it as a
 * permission_change rather than a generic update.
 */
export async function toggleRolePermission(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requirePermission('roles.manage');

  const roleId = String(formData.get('role_id') ?? '');
  const permissionId = String(formData.get('permission_id') ?? '');
  const grant = String(formData.get('grant') ?? '') === 'true';

  if (!roleId || !permissionId) return { error: 'Missing role or permission.' };

  const supabase = await createServerSupabase();

  const { data: role } = await supabase
    .from('roles')
    .select('id, company_id')
    .eq('id', roleId)
    .maybeSingle();

  if (!role) return { error: 'Role not found.' };
  if (role.company_id === null) {
    return { error: 'System templates are read-only. Edit the company copy instead.' };
  }

  if (grant) {
    const { error } = await supabase
      .from('role_permissions')
      .insert({ role_id: roleId, permission_id: permissionId, granted_by: session.profile.id });
    // Two rapid clicks can both try to insert; an existing grant is the state
    // the user asked for, so treat it as success.
    if (error && error.code !== '23505') return describeDbError(error);
  } else {
    const { error } = await supabase
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId)
      .eq('permission_id', permissionId);
    if (error) return describeDbError(error);
  }

  revalidateRoles();
  return { ok: true, message: grant ? 'Permission granted' : 'Permission revoked' };
}
