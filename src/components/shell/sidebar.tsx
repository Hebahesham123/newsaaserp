'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard } from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import { NAV_GROUPS } from './nav';
import { cn } from '@/lib/utils';

export function Sidebar({ permissions }: { permissions: string[] }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const granted = new Set(permissions);

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => item.permissions.length === 0 || item.permissions.some((p) => granted.has(p)),
    ),
  })).filter((group) => group.items.length > 0);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-4" aria-label={t.nav.administration}>
      <Link
        href="/"
        className={cn(
          'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          pathname === '/' ? 'bg-brand-soft text-brand-ink' : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
        )}
      >
        <LayoutDashboard className="size-4 shrink-0" aria-hidden />
        {t.nav.dashboard}
      </Link>

      {visibleGroups.map((group) => (
        <div key={group.labelKey}>
          <p className="mb-1.5 px-3 text-xs font-semibold tracking-wide text-ink-subtle uppercase">
            {t.nav[group.labelKey]}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive(item.href) ? 'page' : undefined}
                  className={cn(
                    'block rounded-lg px-3 py-2 text-sm transition-colors',
                    isActive(item.href)
                      ? 'bg-brand-soft font-medium text-brand-ink'
                      : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                  )}
                >
                  {t.nav[item.labelKey]}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
