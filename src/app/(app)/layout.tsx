import { requireSession } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { createServerSupabase } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const t = await getDictionary();

  const supabase = await createServerSupabase();
  const { data: roleRows } = await supabase
    .from('user_roles')
    .select('roles(name_en, name_ar)')
    .eq('user_id', session.profile.id);

  const roleNames = (roleRows ?? [])
    .map((row) => {
      const role = row.roles as unknown as { name_en: string; name_ar: string } | null;
      if (!role) return null;
      return session.profile.locale === 'ar' ? role.name_ar : role.name_en;
    })
    .filter((n): n is string => Boolean(n));

  const roleSummary = session.profile.is_platform_admin
    ? 'Super Admin'
    : roleNames.length > 0
      ? roleNames.join(' · ')
      : (session.profile.job_title ?? '');

  const companyName =
    session.company && session.profile.locale === 'ar'
      ? session.company.name_ar
      : (session.company?.name_en ?? null);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-e border-border bg-surface lg:block">
        <div className="border-b border-border px-5 py-4">
          <p className="text-sm font-semibold text-ink">{t.app.name}</p>
          <p className="mt-0.5 text-xs text-ink-subtle">{t.app.tagline}</p>
        </div>
        <Sidebar permissions={[...session.permissions]} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar userName={session.profile.full_name} companyName={companyName} roleSummary={roleSummary} />
        <main className="flex-1 px-5 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
