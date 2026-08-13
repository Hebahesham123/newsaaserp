import 'server-only';

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';
import type { Database } from './database.types';

/**
 * Server client bound to the request's cookies. Runs as the signed-in user, so
 * RLS applies. Use this for anything a user is allowed to see.
 */
export async function createServerSupabase() {
  const env = publicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Service-role client. **Bypasses RLS entirely.**
 *
 * Legitimate uses are narrow: reading `store_credentials`, writing webhook
 * payloads that arrive without a user session, and background sync jobs.
 * Never construct this in response to unvalidated user input, and never
 * import it from a Client Component.
 */
export function createAdminSupabase() {
  const pub = publicEnv();
  const srv = serverEnv();

  return createSupabaseClient<Database>(pub.NEXT_PUBLIC_SUPABASE_URL, srv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
