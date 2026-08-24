import { requireSession } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { getTheme } from '@/lib/theme/server';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar, type TopbarNotification } from '@/components/shell/topbar';
import { createServerSupabase } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const [t, locale, theme] = await Promise.all([getDictionary(), getLocale(), getTheme()]);

  const supabase = await createServerSupabase();

  const [roleResult, notificationResult, approvalResult] = await Promise.all([
    supabase.from('user_roles').select('roles(name_en, name_ar)').eq('user_id', session.profile.id),
    // The bell shows the most recent regardless of read state, so a user can
    // find something they have already dismissed.
    supabase
      .from('notifications')
      .select('id, title_en, title_ar, body_en, body_ar, severity, link, created_at, read_at')
      .eq('recipient_id', session.profile.id)
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('approval_requests')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
  ]);

  const roleNames = (roleResult.data ?? [])
    .map((row) => {
      const role = row.roles as unknown as { name_en: string; name_ar: string } | null;
      if (!role) return null;
      return locale === 'ar' ? role.name_ar : role.name_en;
    })
    .filter((name): name is string => Boolean(name));

  const roleSummary = session.profile.is_platform_admin
    ? 'Super Admin'
    : roleNames.length > 0
      ? roleNames.join(' · ')
      : (session.profile.job_title ?? '');

  const companyName =
    session.company && locale === 'ar' ? session.company.name_ar : (session.company?.name_en ?? null);

  const notifications: TopbarNotification[] = (notificationResult.data ?? []).map((row) => ({
    id: row.id,
    title: locale === 'ar' ? row.title_ar : row.title_en,
    body: (locale === 'ar' ? row.body_ar : row.body_en) ?? null,
    severity: row.severity as TopbarNotification['severity'],
    link: row.link,
    createdAt: row.created_at,
    read: row.read_at != null,
  }));

  const unreadNotifications = notifications.filter((n) => !n.read).length;

  // Sidebar badges surface work waiting on this user without a page visit.
  const badges: Record<string, number> = {};
  if (approvalResult.count) badges['/approvals'] = approvalResult.count;
  if (unreadNotifications) badges['/notifications'] = unreadNotifications;

  const permissions = [...session.permissions];

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-e border-border bg-surface lg:flex">
        <div className="border-b border-border px-5 py-4">
          <p className="text-sm font-semibold text-ink">{t.app.name}</p>
          <p className="mt-0.5 text-xs text-ink-subtle">{t.app.tagline}</p>
        </div>
        <div className="min-h-0 flex-1">
          <Sidebar permissions={permissions} badges={badges} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          userName={session.profile.full_name}
          userEmail={session.profile.email}
          companyName={companyName}
          roleSummary={roleSummary}
          theme={theme}
          notifications={notifications}
          permissions={permissions}
          appName={t.app.name}
          tagline={t.app.tagline}
        />
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
