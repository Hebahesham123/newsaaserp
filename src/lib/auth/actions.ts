'use server';

import { cookies, headers } from 'next/headers';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase/server';
import { LOCALE_COOKIE, isLocale } from '@/i18n/config';

export type AuthState = { error?: string };

/**
 * Signs a user in and records the attempt (§2.5.4).
 *
 * The attempt log is written with the service role because a *failed* login has
 * no session to write with — and an unrecorded failure would defeat the lockout
 * rule the spec requires.
 */
export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/');

  if (!email || !password) {
    return { error: 'invalidCredentials' };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  const headerList = await headers();
  const ip = headerList.get('x-forwarded-for') ?? headerList.get('x-real-ip');
  const userAgent = headerList.get('user-agent');

  try {
    const admin = createAdminSupabase();
    await admin.rpc('record_login_attempt', {
      p_email: email,
      p_succeeded: !error,
      p_failure_reason: error?.message ?? null,
      p_ip: ip,
      p_user_agent: userAgent,
    });
  } catch {
    // Never let audit bookkeeping block a legitimate sign-in. The failure is
    // visible in server logs; the user still gets in.
  }

  if (error) {
    return { error: 'invalidCredentials' };
  }

  // Adopt the user's stored language preference (§2.5.2) for this session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile } = await supabase
      .from('app_users')
      .select('locale, status')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (profile && profile.status !== 'active') {
      await supabase.auth.signOut();
      return { error: profile.status === 'blocked' ? 'accountLocked' : 'accountInactive' };
    }

    if (profile && isLocale(profile.locale)) {
      const cookieStore = await cookies();
      cookieStore.set(LOCALE_COOKIE, profile.locale, { path: '/', maxAge: 60 * 60 * 24 * 365 });
    }
  }

  // `next` arrives from a query parameter, so it is a plain string rather than
  // a known route. The leading-slash check keeps it same-origin — without it,
  // "//evil.example" would be an open redirect.
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  redirect(target as Route);
}

export async function signOut() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect('/login');
}

export async function setLocale(formData: FormData) {
  const locale = String(formData.get('locale') ?? '');
  if (!isLocale(locale)) return;

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, { path: '/', maxAge: 60 * 60 * 24 * 365 });

  // Persist to the user's profile so the choice survives a new device (§2.5.2).
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await supabase.from('app_users').update({ locale }).eq('auth_user_id', user.id);
  }

  revalidatePath('/', 'layout');
}
