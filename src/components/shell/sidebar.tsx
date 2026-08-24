'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import { DASHBOARD_ITEM, NAV_GROUPS, type NavItem } from './nav';
import { cn } from '@/lib/utils';

function useVisibleGroups(permissions: string[]) {
  const granted = new Set(permissions);
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => item.permissions.length === 0 || item.permissions.some((p) => granted.has(p)),
    ),
  })).filter((group) => group.items.length > 0);
}

function NavLink({
  item,
  active,
  badge,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  badge?: number;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
        active
          ? 'bg-brand-soft font-medium text-brand-ink'
          : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{t.nav[item.labelKey]}</span>
      {badge ? (
        <span className="tnum rounded-full bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}

function NavTree({
  permissions,
  badges,
  onNavigate,
}: {
  permissions: string[];
  badges?: Record<string, number>;
  onNavigate?: () => void;
}) {
  const { t } = useI18n();
  const pathname = usePathname();
  const groups = useVisibleGroups(permissions);

  // /roles must not light up when the user is on /roles/matrix, so an item is
  // active on a prefix match only when no longer, more specific item matches.
  const allHrefs = [DASHBOARD_ITEM, ...groups.flatMap((g) => g.items)].map((item) => item.href as string);
  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (pathname === href) return true;
    if (!pathname.startsWith(`${href}/`)) return false;
    return !allHrefs.some((other) => other !== href && other.startsWith(`${href}/`) && pathname.startsWith(other));
  };

  return (
    <nav className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-4" aria-label={t.nav.administration}>
      <NavLink item={DASHBOARD_ITEM} active={isActive('/')} onNavigate={onNavigate} />

      {groups.map((group) => (
        <div key={group.labelKey}>
          <p className="mb-1.5 px-3 text-xs font-semibold tracking-wide text-ink-subtle uppercase">
            {t.nav[group.labelKey]}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <NavLink
                  item={item}
                  active={isActive(item.href)}
                  badge={badges?.[item.href]}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({
  permissions,
  badges,
}: {
  permissions: string[];
  badges?: Record<string, number>;
}) {
  return <NavTree permissions={permissions} badges={badges} />;
}

/**
 * The same tree as a slide-over for narrow screens. Warehouse and confirmation
 * staff work on tablets, so the whole navigation has to be reachable there.
 */
export function MobileNav({
  permissions,
  badges,
  appName,
  tagline,
}: {
  permissions: string[];
  badges?: Record<string, number>;
  appName: string;
  tagline: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  // Closing on navigation is handled by each link's onNavigate rather than an
  // effect on pathname, so no state update happens during a render pass.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t.common.menu}
        className="rounded-lg p-2 text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink lg:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={t.common.close}
            onClick={() => setOpen(false)}
            className="animate-overlay-in absolute inset-0 cursor-default bg-black/60"
          />
          <div className="animate-panel-in absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col border-e border-border bg-surface">
            <div className="flex items-start justify-between gap-2 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{appName}</p>
                <p className="mt-0.5 truncate text-xs text-ink-subtle">{tagline}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t.common.close}
                className="rounded-lg p-1.5 text-ink-subtle hover:bg-surface-muted hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <NavTree permissions={permissions} badges={badges} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
