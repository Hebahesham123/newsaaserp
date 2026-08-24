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

const shiftSchema = z.object({
  name: z.string().trim().min(2, 'Required').max(120),
  start_time: z.string().trim().min(1, 'Required'),
  end_time: z.string().trim().min(1, 'Required'),
  break_start: z.string().trim().optional(),
  break_end: z.string().trim().optional(),
  department_id: z.string().trim().optional(),
  timezone: z.string().trim().max(60).optional(),
  workload_capacity: z.string().trim().optional(),
});

/** 0 = Sunday … 6 = Saturday, matching working_days smallint[]. */
function weekdays(formData: FormData): number[] {
  return multi(formData, 'working_days')
    .map(Number)
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
}

function toRow(values: z.infer<typeof shiftSchema>, formData: FormData) {
  return {
    name: values.name,
    start_time: values.start_time,
    end_time: values.end_time,
    break_start: nullIfBlank(values.break_start),
    break_end: nullIfBlank(values.break_end),
    department_id: nullIfBlank(values.department_id),
    timezone: nullIfBlank(values.timezone) ?? 'Africa/Cairo',
    workload_capacity: numberOrNull(values.workload_capacity),
    working_days: weekdays(formData),
    is_active: checkbox(formData, 'is_active'),
  };
}

export async function createShift(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('shifts.manage');

  const parsed = shiftSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const capacity = numberOrNull(parsed.data.workload_capacity);
  if (capacity !== null && capacity <= 0) {
    return { fieldErrors: { workload_capacity: 'Must be greater than zero' } };
  }

  const scope = await resolveCompanyId(session, formData);
  if ('error' in scope) return scope.error;

  const supabase = await createServerSupabase();
  const { error } = await supabase.from('shifts').insert({
    ...toRow(parsed.data, formData),
    company_id: scope.companyId,
    created_by: session.profile.id,
  });

  if (error) return describeDbError(error);

  revalidateEntity('/shifts');
  return { ok: true, message: 'Shift created' };
}

export async function updateShift(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('shifts.manage');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing shift id.' };

  const parsed = shiftSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const capacity = numberOrNull(parsed.data.workload_capacity);
  if (capacity !== null && capacity <= 0) {
    return { fieldErrors: { workload_capacity: 'Must be greater than zero' } };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('shifts')
    .update({ ...toRow(parsed.data, formData), updated_by: session.profile.id })
    .eq('id', id);

  if (error) return describeDbError(error);

  revalidateEntity('/shifts');
  return { ok: true, message: 'Shift updated' };
}

export async function archiveShift(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('shifts.manage');
  const id = String(formData.get('id') ?? '');
  const restore = formData.get('restore') != null;
  if (!id) return { error: 'Missing shift id.' };

  const result = await archiveRow('shifts', id, session, restore);
  if (result.ok) revalidateEntity('/shifts');
  return result;
}
