'use server';

import { z } from 'zod';
import { requirePermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import { archiveRow, resolveCompanyId, revalidateEntity } from '@/lib/actions';
import {
  checkbox,
  describeDbError,
  fieldErrorsFrom,
  nullIfBlank,
  type ActionState,
} from '@/lib/forms';

const departmentSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, hyphen and underscore only'),
  name_en: z.string().trim().min(2, 'Required').max(200),
  name_ar: z.string().trim().min(2, 'Required').max(200),
  manager_id: z.string().trim().optional(),
  description: z.string().trim().max(1000).optional(),
});

export async function createDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('departments.manage');

  const parsed = departmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const scope = await resolveCompanyId(session, formData);
  if ('error' in scope) return scope.error;

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('departments').insert({
    company_id: scope.companyId,
    code: parsed.data.code,
    name_en: parsed.data.name_en,
    name_ar: parsed.data.name_ar,
    manager_id: nullIfBlank(parsed.data.manager_id),
    description: nullIfBlank(parsed.data.description),
    is_active: checkbox(formData, 'is_active'),
    created_by: session.profile.id,
  });

  if (error) {
    return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  }

  revalidateEntity('/departments');
  return { ok: true, message: 'Department created' };
}

export async function updateDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('departments.manage');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing department id.' };

  const parsed = departmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('departments')
    .update({
      code: parsed.data.code,
      name_en: parsed.data.name_en,
      name_ar: parsed.data.name_ar,
      manager_id: nullIfBlank(parsed.data.manager_id),
      description: nullIfBlank(parsed.data.description),
      is_active: checkbox(formData, 'is_active'),
      updated_by: session.profile.id,
    })
    .eq('id', id);

  if (error) {
    return describeDbError(error, { uniqueField: 'code', uniqueMessage: 'This code is already used.' });
  }

  revalidateEntity('/departments');
  return { ok: true, message: 'Department updated' };
}

export async function archiveDepartment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('departments.manage');
  const id = String(formData.get('id') ?? '');
  const restore = formData.get('restore') != null;
  if (!id) return { error: 'Missing department id.' };

  const result = await archiveRow('departments', id, session, restore);
  if (result.ok) revalidateEntity('/departments');
  return result;
}
