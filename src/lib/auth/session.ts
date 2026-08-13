import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import type { AppUserRow, CompanyRow, FieldVisibility } from '@/lib/supabase/database.types';

export type FieldPolicy = {
  entity: string;
  field: string;
  visibility: FieldVisibility;
  can_edit: boolean;
  mask_pattern: string | null;
};

export type Session = {
  authUserId: string;
  profile: AppUserRow;
  company: CompanyRow | null;
  permissions: ReadonlySet<string>;
  fieldPolicies: FieldPolicy[];
};

/**
 * Loads the signed-in user's profile, effective permissions and field policies.
 *
 * `cache` dedupes this across a single render pass, so a layout and the page
 * beneath it share one round trip.
 *
 * These values gate the *UI*. They are not the security boundary — the database
 * enforces access via RLS (§2.7), so a forged permission set changes what a user
 * sees rendered, never what they can read or write.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('app_users')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!profile) return null;

  const [{ data: permissionCodes }, { data: fieldPolicies }, companyResult] = await Promise.all([
    supabase.rpc('my_permission_codes'),
    supabase.rpc('my_field_policies'),
    profile.company_id
      ? supabase.from('companies').select('*').eq('id', profile.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    authUserId: user.id,
    profile,
    company: (companyResult?.data as CompanyRow | null) ?? null,
    permissions: new Set<string>((permissionCodes as string[] | null) ?? []),
    fieldPolicies: (fieldPolicies as FieldPolicy[] | null) ?? [],
  };
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

/** §2.7.1 action-level check, mirroring app.has_perm() in the database. */
export function can(session: Session | null, code: string): boolean {
  if (!session) return false;
  if (session.profile.is_platform_admin) return true;
  return session.permissions.has(code);
}

export function canAny(session: Session | null, codes: string[]): boolean {
  return codes.some((code) => can(session, code));
}

/**
 * Screen-level gate (§2.7.1). Redirects rather than throwing so a user who
 * follows a stale link lands somewhere sensible instead of on an error page.
 */
export async function requirePermission(code: string): Promise<Session> {
  const session = await requireSession();
  if (!can(session, code)) redirect('/forbidden');
  return session;
}

/** §2.7.1 field-level resolution. Most restrictive policy already applied by the RPC. */
export function fieldPolicy(session: Session | null, entity: string, field: string): FieldPolicy | null {
  if (!session) return null;
  return session.fieldPolicies.find((p) => p.entity === entity && p.field === field) ?? null;
}

/**
 * §2.7.3 partial masking. Keeps the first three and last two characters so an
 * agent can still recognise a number without being able to exfiltrate it.
 */
export function maskValue(value: string | null | undefined, pattern?: string | null): string {
  if (!value) return '—';
  if (value.length <= 5) return '*'.repeat(value.length);
  const head = value.slice(0, 3);
  const tail = value.slice(-2);
  const middle = '*'.repeat(Math.max(pattern ? pattern.split('*').length - 1 : 4, value.length - 5));
  return `${head}${middle}${tail}`;
}

/** Applies a field policy to a raw value, returning what the user may actually see. */
export function applyFieldPolicy(
  session: Session | null,
  entity: string,
  field: string,
  value: string | null | undefined,
): string | null {
  const policy = fieldPolicy(session, entity, field);
  if (!policy || policy.visibility === 'visible') return value ?? null;
  if (policy.visibility === 'hidden') return null;
  return maskValue(value, policy.mask_pattern);
}
