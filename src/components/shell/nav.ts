import type { Route } from 'next';
import type { Dictionary } from '@/i18n/dictionaries/en';

export type NavItem = {
  /** Typed against the real route tree, so a renamed page breaks the build. */
  href: Route;
  labelKey: keyof Dictionary['nav'];
  /** Any one of these permissions reveals the item. Empty = always visible. */
  permissions: string[];
};

export type NavGroup = {
  labelKey: keyof Dictionary['nav'];
  items: NavItem[];
};

/**
 * Sidebar structure for Phase 1 (§2.14 Required Screens).
 *
 * Items are filtered by permission so a Picker never sees the Companies entry.
 * This is presentation only — the database refuses the data regardless (§2.7).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'administration',
    items: [
      { href: '/companies', labelKey: 'companies', permissions: ['companies.view'] },
      { href: '/merchants', labelKey: 'merchants', permissions: ['merchants.view'] },
      { href: '/stores', labelKey: 'stores', permissions: ['stores.view'] },
      { href: '/warehouses', labelKey: 'warehouses', permissions: ['warehouses.view'] },
    ],
  },
  {
    labelKey: 'accessControl',
    items: [
      { href: '/users', labelKey: 'users', permissions: ['users.view'] },
      { href: '/roles', labelKey: 'roles', permissions: ['roles.view', 'roles.manage'] },
      { href: '/roles/matrix', labelKey: 'permissionMatrix', permissions: ['roles.manage'] },
    ],
  },
  {
    labelKey: 'organisation',
    items: [
      { href: '/departments', labelKey: 'departments', permissions: ['departments.view', 'departments.manage'] },
      { href: '/teams', labelKey: 'teams', permissions: ['teams.view', 'teams.manage'] },
      { href: '/shifts', labelKey: 'shifts', permissions: ['shifts.view', 'shifts.manage'] },
    ],
  },
  {
    labelKey: 'monitoring',
    items: [
      { href: '/sync-log', labelKey: 'syncLog', permissions: ['stores.sync.view'] },
      { href: '/activity-log', labelKey: 'activityLog', permissions: ['audit.view'] },
      { href: '/approvals', labelKey: 'approvals', permissions: ['approvals.view'] },
    ],
  },
];
