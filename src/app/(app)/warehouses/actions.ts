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
  numberOrNull,
  type ActionState,
} from '@/lib/forms';

const WAREHOUSE_TYPES = [
  'main', 'fulfillment', 'retail_store', 'branch', 'marketplace', 'returns', 'temporary', 'damaged',
] as const;

const warehouseSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, hyphen and underscore only'),
  name: z.string().trim().min(2, 'Required').max(200),
  warehouse_type: z.enum(WAREHOUSE_TYPES),
  dedicated_merchant_id: z.string().trim().optional(),
  manager_id: z.string().trim().optional(),
  country: z.string().trim().max(80).optional(),
  region: z.string().trim().max(80).optional(),
  address: z.string().trim().max(400).optional(),
  phone: z.string().trim().max(40).optional(),
  capacity_cbm: z.string().trim().optional(),
  dock_doors: z.string().trim().optional(),
});

function toRow(values: z.infer<typeof warehouseSchema>, isActive: boolean) {
  const settings: Record<string, number> = {};
  const capacity = numberOrNull(values.capacity_cbm);
  const docks = numberOrNull(values.dock_doors);
  if (capacity !== null) settings.capacity_cbm = capacity;
  if (docks !== null) settings.dock_doors = docks;

  return {
    code: values.code,
    name: values.name,
    warehouse_type: values.warehouse_type,
    // Null = shared warehouse serving every merchant in the company.
    dedicated_merchant_id: nullIfBlank(values.dedicated_merchant_id),
    manager_id: nullIfBlank(values.manager_id),
    country: nullIfBlank(values.country),
    region: nullIfBlank(values.region),
    address: nullIfBlank(values.address),
    phone: nullIfBlank(values.phone),
    is_active: isActive,
    settings,
  };
}

export async function createWarehouse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('warehouses.create');

  const parsed = warehouseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const scope = await resolveCompanyId(session, formData);
  if ('error' in scope) return scope.error;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from('warehouses')
    .insert({
      ...toRow(parsed.data, checkbox(formData, 'is_active')),
      company_id: scope.companyId,
      created_by: session.profile.id,
    })
    .select('id')
    .single();

  if (error) {
    return describeDbError(error, {
      uniqueField: 'code',
      uniqueMessage: 'This code is already used in this company.',
    });
  }

  revalidateEntity('/warehouses', data.id);
  return { ok: true, message: 'Warehouse created' };
}

export async function updateWarehouse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('warehouses.edit');

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Missing warehouse id.' };

  const parsed = warehouseSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from('warehouses')
    .update({ ...toRow(parsed.data, checkbox(formData, 'is_active')), updated_by: session.profile.id })
    .eq('id', id);

  if (error) {
    return describeDbError(error, {
      uniqueField: 'code',
      uniqueMessage: 'This code is already used in this company.',
    });
  }

  revalidateEntity('/warehouses', id);
  return { ok: true, message: 'Warehouse updated' };
}

export async function archiveWarehouse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requirePermission('warehouses.edit');
  const id = String(formData.get('id') ?? '');
  const restore = formData.get('restore') != null;
  if (!id) return { error: 'Missing warehouse id.' };

  const result = await archiveRow('warehouses', id, session, restore);
  if (result.ok) revalidateEntity('/warehouses', id);
  return result;
}
