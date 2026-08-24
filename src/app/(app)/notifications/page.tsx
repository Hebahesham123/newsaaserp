import Link from 'next/link';
import type { Route } from 'next';
import { requireSession } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, Dot, EmptyState, PageHeader, StatTile } from '@/components/ui';
import { DateTime } from '@/components/status-badge';
import { ActionButton } from '@/components/form/action-button';
import { MarkAllReadButton } from './mark-all';
import { markNotificationRead } from './actions';

const SEVERITY_TONE = { critical: 'danger', warning: 'warning', info: 'info' } as const;

/** §2.10 Notifications and Alerts — the recipient's own inbox. */
export default async function NotificationsPage() {
  const session = await requireSession();
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  // RLS restricts this to the signed-in recipient, so no filter is needed here.
  const { data: notifications } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = notifications ?? [];
  const unread = rows.filter((row) => row.read_at == null);
  const critical = rows.filter((row) => row.severity === 'critical' && row.read_at == null);

  return (
    <>
      <PageHeader
        title={t.notifications.title}
        subtitle={t.notifications.subtitle}
        actions={<MarkAllReadButton disabled={unread.length === 0} />}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatTile label={t.notifications.unread} value={unread.length} tone="info" />
        <StatTile label={t.status.suspended} value={critical.length} tone="danger" />
        <StatTile label={t.common.total} value={rows.length} tone="neutral" />
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={t.notifications.empty} hint={t.notifications.subtitle} />
        </Card>
      ) : (
        <ul className="space-y-2">
          {rows.map((notification) => {
            const title = locale === 'ar' ? notification.title_ar : notification.title_en;
            const body = locale === 'ar' ? notification.body_ar : notification.body_en;
            const tone = SEVERITY_TONE[notification.severity as keyof typeof SEVERITY_TONE] ?? 'info';
            const isUnread = notification.read_at == null;

            return (
              <li key={notification.id}>
                <Card className={isUnread ? 'border-border-strong' : 'opacity-80'}>
                  <div className="flex flex-wrap items-start gap-3 px-5 py-4">
                    <span className="mt-1.5">
                      <Dot tone={tone} />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink">{title}</p>
                        {isUnread ? <Badge tone={tone}>{t.notifications.unread}</Badge> : null}
                        <code className="font-mono text-[11px] text-ink-subtle" dir="ltr">
                          {notification.event_code}
                        </code>
                      </div>

                      {body ? <p className="mt-1 text-sm text-ink-muted">{body}</p> : null}

                      <p className="tnum mt-1.5 text-xs text-ink-subtle">
                        <DateTime value={notification.created_at} />
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {notification.link ? (
                        <Link
                          href={notification.link as Route}
                          className="text-sm text-brand hover:underline"
                        >
                          {t.common.seeDetails}
                        </Link>
                      ) : null}
                      {isUnread ? (
                        <ActionButton
                          action={markNotificationRead}
                          fields={{ id: notification.id }}
                          label={t.notifications.markRead}
                          icon="approve"
                          iconOnly
                        />
                      ) : null}
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 text-xs text-ink-subtle">
        {session.profile.full_name} · {rows.length} {t.common.results}
      </p>
    </>
  );
}
