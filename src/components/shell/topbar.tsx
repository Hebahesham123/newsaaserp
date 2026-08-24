'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  Check,
  ChevronDown,
  Languages,
  LogOut,
  Moon,
  Sun,
  UserCircle2,
} from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import { LOCALE_LABELS, type Locale } from '@/i18n/config';
import { setLocale, signOut } from '@/lib/auth/actions';
import { setTheme } from '@/lib/theme/actions';
import type { Theme } from '@/lib/theme/config';
import { Avatar, Badge } from '@/components/ui';
import { MobileNav } from './sidebar';
import { cn } from '@/lib/utils';

export type TopbarNotification = {
  id: string;
  title: string;
  body: string | null;
  severity: 'info' | 'warning' | 'critical';
  link: string | null;
  createdAt: string;
  read: boolean;
};

/** Closes a dropdown on outside click and on Escape. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close();

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  return ref;
}

function NotificationBell({ notifications }: { notifications: TopbarNotification[] }) {
  const { t, formatDateTime } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`${t.notifications.title}${unread > 0 ? ` — ${unread} ${t.notifications.unread}` : ''}`}
        aria-expanded={open}
        className="relative rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 ? (
          <span className="tnum absolute -end-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-brand-contrast">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute end-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-card border border-border bg-surface shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <p className="text-sm font-semibold text-ink">{t.notifications.title}</p>
            {unread > 0 ? (
              <Badge tone="danger">
                {unread} {t.notifications.unread}
              </Badge>
            ) : null}
          </div>

          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {notifications.length === 0 ? (
              <li className="px-4 py-8 text-center text-sm text-ink-subtle">{t.notifications.empty}</li>
            ) : (
              notifications.map((notification) => (
                <li key={notification.id}>
                  <Link
                    href={(notification.link ?? '/notifications') as never}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'block px-4 py-3 transition-colors hover:bg-surface-muted',
                      notification.read ? 'opacity-70' : undefined,
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          'mt-1.5 size-1.5 shrink-0 rounded-full',
                          notification.severity === 'critical'
                            ? 'bg-danger'
                            : notification.severity === 'warning'
                              ? 'bg-warning'
                              : 'bg-info',
                        )}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{notification.title}</p>
                        {notification.body ? (
                          <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{notification.body}</p>
                        ) : null}
                        <p className="tnum mt-1 text-[11px] text-ink-subtle">
                          {formatDateTime(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              ))
            )}
          </ul>

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block border-t border-border px-4 py-2.5 text-center text-xs font-medium text-brand hover:bg-surface-muted"
          >
            {t.common.viewAll}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function ThemeToggle({ theme }: { theme: Theme }) {
  const { t } = useI18n();
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const Icon = theme === 'dark' ? Sun : Moon;

  return (
    <form action={setTheme}>
      <input type="hidden" name="theme" value={next} />
      <button
        type="submit"
        title={`${t.common.theme}: ${next === 'dark' ? t.common.dark : t.common.light}`}
        aria-label={`${t.common.theme}: ${next === 'dark' ? t.common.dark : t.common.light}`}
        className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
      >
        <Icon className="size-5" aria-hidden />
      </button>
    </form>
  );
}

function UserMenu({
  userName,
  roleSummary,
  email,
  theme,
}: {
  userName: string;
  roleSummary: string;
  email: string;
  theme: Theme;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const otherLocale: Locale = locale === 'ar' ? 'en' : 'ar';

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg py-1 ps-1 pe-2 transition-colors hover:bg-surface-muted"
      >
        <Avatar name={userName} />
        <span className="hidden min-w-0 text-start sm:block">
          <span className="block max-w-32 truncate text-sm font-medium text-ink">{userName}</span>
          <span className="block max-w-32 truncate text-xs text-ink-subtle">{roleSummary}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-ink-subtle" aria-hidden />
      </button>

      {open ? (
        <div className="absolute end-0 z-40 mt-2 w-60 overflow-hidden rounded-card border border-border bg-surface shadow-lg">
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-medium text-ink">{userName}</p>
            <p className="truncate text-xs text-ink-subtle" dir="ltr">
              {email}
            </p>
          </div>

          <div className="p-1">
            <form action={setLocale}>
              <input type="hidden" name="locale" value={otherLocale} />
              <button
                type="submit"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                <Languages className="size-4" aria-hidden />
                {LOCALE_LABELS[otherLocale]}
              </button>
            </form>

            <form action={setTheme}>
              <input type="hidden" name="theme" value={theme === 'dark' ? 'light' : 'dark'} />
              <button
                type="submit"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
              >
                {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
                {theme === 'dark' ? t.common.light : t.common.dark}
                <Check className="ms-auto size-3.5 opacity-0" aria-hidden />
              </button>
            </form>

            <Link
              href="/users"
              onClick={() => setOpen(false)}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <UserCircle2 className="size-4" aria-hidden />
              {t.nav.users}
            </Link>
          </div>

          <div className="border-t border-border p-1">
            <form action={signOut}>
              <button
                type="submit"
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-danger transition-colors hover:bg-danger-soft"
              >
                <LogOut className="size-4 flip-icon" aria-hidden />
                {t.common.signOut}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function Topbar({
  userName,
  userEmail,
  companyName,
  roleSummary,
  theme,
  notifications,
  permissions,
  appName,
  tagline,
}: {
  userName: string;
  userEmail: string;
  companyName: string | null;
  roleSummary: string;
  theme: Theme;
  notifications: TopbarNotification[];
  permissions: string[];
  appName: string;
  tagline: string;
}) {
  const { t } = useI18n();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 py-2.5 backdrop-blur lg:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <MobileNav permissions={permissions} appName={appName} tagline={tagline} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{companyName ?? t.app.name}</p>
          <p className="truncate text-xs text-ink-subtle">{roleSummary}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle theme={theme} />
        <NotificationBell notifications={notifications} />
        <UserMenu userName={userName} roleSummary={roleSummary} email={userEmail} theme={theme} />
      </div>
    </header>
  );
}
