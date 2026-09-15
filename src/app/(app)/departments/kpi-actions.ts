'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requirePermission } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  checkbox,
  describeDbError,
  fieldErrorsFrom,
  nullIfBlank,
  numberOrNull,
  type ActionState,
} from '@/lib/forms';

/**
 * §KPI — definitions and results for a department.
 *
 * Achievement is never written here. It depends on the KPI's direction, so it
 * is derived in `kpi_performance`; storing it would go stale the moment a
 * definition's direction was corrected.
 */

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly'] as const;
const DIRECTIONS = ['higher_is_better', 'lower_is_better'] as const;
type KpiSubjectName = 'department' | 'team' | 'user' | 'role';

const definitionSchema = z.object({
  department_id: z.string().uuid(),
  code: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(48)
    .regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dot, hyphen and underscore only'),
  name_en: z.string().trim().min(2, 'Required').max(200),
  name_ar: z.string().trim().min(2, 'Required').max(200),
  unit: z.string().trim().max(40).optional(),
  frequency: z.enum(FREQUENCIES),
  direction: z.enum(DIRECTIONS),
  default_target: z.string().trim().optional(),
  description: z.string().trim().max(1000).optional(),
  sort_order: z.string().trim().optional(),
});

export async function saveKpiDefinition(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('kpi.manage');

  const parsed = definitionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();

  // The department fixes the tenant — never take company_id from the form.
  const { data: department } = await supabase
    .from('departments')
    .select('id, company_id')
    .eq('id', parsed.data.department_id)
    .maybeSingle();

  if (!department) return { error: 'Department not found.' };

  const row = {
    department_id: department.id,
    code: parsed.data.code,
    name_en: parsed.data.name_en,
    name_ar: parsed.data.name_ar,
    unit: nullIfBlank(parsed.data.unit),
    frequency: parsed.data.frequency,
    direction: parsed.data.direction,
    default_target: numberOrNull(parsed.data.default_target),
    description: nullIfBlank(parsed.data.description),
    sort_order: numberOrNull(parsed.data.sort_order) ?? 0,
    is_active: checkbox(formData, 'is_active'),
  };

  const id = String(formData.get('id') ?? '');

  const { error } = id
    ? await supabase
        .from('kpi_definitions')
        .update({ ...row, updated_by: session.profile.id })
        .eq('id', id)
    : await supabase
        .from('kpi_definitions')
        .insert({ ...row, company_id: department.company_id, created_by: session.profile.id });

  if (error) {
    return describeDbError(error, {
      uniqueField: 'code',
      uniqueMessage: 'This department already has a KPI with that code.',
    });
  }

  revalidatePath(`/departments/${department.id}`);
  return { ok: true, message: id ? 'KPI updated' : 'KPI created' };
}

const entrySchema = z.object({
  kpi_id: z.string().uuid(),
  /**
   * `type:uuid`, from one flat picker.
   *
   * Sent as a single field rather than a type plus an id, because two separate
   * fields can disagree — and a row claiming to measure a team while carrying a
   * user id is exactly what the table's check constraint exists to refuse.
   */
  subject_ref: z
    .string()
    .trim()
    .regex(
      /^(department|team|user|role):[0-9a-fA-F-]{36}$/,
      'Choose who this measures',
    ),
  period_start: z.string().trim().min(1, 'Required'),
  period_end: z.string().trim().min(1, 'Required'),
  target_value: z.string().trim().optional(),
  actual_value: z.string().trim().optional(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Records one period for one subject.
 *
 * The subject column is chosen from the declared subject rather than sent as
 * four nullable fields, so the row cannot claim to measure a team while
 * carrying a user id — the same invariant the table's check constraint holds.
 */
export async function saveKpiEntry(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('kpi.record');

  const parsed = entrySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  if (parsed.data.period_end < parsed.data.period_start) {
    return { fieldErrors: { period_end: 'The period cannot end before it starts.' } };
  }

  const supabase = await createServerSupabase();

  const { data: definition } = await supabase
    .from('kpi_definitions')
    .select('id, company_id, department_id')
    .eq('id', parsed.data.kpi_id)
    .maybeSingle();

  if (!definition) return { error: 'KPI not found.' };

  const [subject, subjectId] = parsed.data.subject_ref.split(':') as [KpiSubjectName, string];

  const subjectColumn = {
    department: 'department_id',
    team: 'team_id',
    user: 'user_id',
    role: 'role_id',
  }[subject];

  const row = {
    kpi_id: definition.id,
    company_id: definition.company_id,
    subject,
    [subjectColumn]: subjectId,
    period_start: parsed.data.period_start,
    period_end: parsed.data.period_end,
    target_value: numberOrNull(parsed.data.target_value),
    actual_value: numberOrNull(parsed.data.actual_value),
    note: nullIfBlank(parsed.data.note),
  };

  const id = String(formData.get('id') ?? '');

  const { error } = id
    ? await supabase
        .from('kpi_entries')
        .update({ ...row, updated_by: session.profile.id })
        .eq('id', id)
    : await supabase
        .from('kpi_entries')
        .insert({ ...row, created_by: session.profile.id });

  if (error) {
    return describeDbError(error, {
      uniqueMessage: 'That subject already has a result for this period — edit it instead.',
    });
  }

  revalidatePath(`/departments/${definition.department_id}`);
  return { ok: true, message: id ? 'Result updated' : 'Result recorded' };
}

export async function deleteKpiDefinition(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission('kpi.manage');

  const id = String(formData.get('id') ?? '');
  const departmentId = String(formData.get('department_id') ?? '');
  if (!id) return { error: 'Missing KPI id.' };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('kpi_definitions').delete().eq('id', id);
  if (error) return describeDbError(error);

  revalidatePath(`/departments/${departmentId}`);
  return { ok: true, message: 'KPI removed' };
}
