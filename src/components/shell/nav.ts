import type { Route } from 'next';
import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Contact,
  CopyCheck,
  Factory,
  FileText,
  KeyRound,
  LayoutDashboard,
  Link2Off,
  ListChecks,
  ListX,
  MessageSquare,
  Network,
  Package,
  PhoneCall,
  PiggyBank,
  Receipt,
  RefreshCcw,
  Scale,
  ScrollText,
  Send,
  ShieldBan,
  ShieldCheck,
  ShoppingCart,
  Store,
  Tags,
  TrendingUp,
  Truck,
  Undo2,
  Users,
  UsersRound,
  Warehouse,
} from 'lucide-react';
import type { Dictionary } from '@/i18n/dictionaries/en';

export type NavIcon = typeof LayoutDashboard;

export type NavItem = {
  /** Typed against the real route tree, so a renamed page breaks the build. */
  href: Route;
  labelKey: keyof Dictionary['nav'];
  /** Any one of these permissions reveals the item. Empty = always visible. */
  permissions: string[];
  icon: NavIcon;
};

export type NavGroup = {
  labelKey: keyof Dictionary['nav'];
  items: NavItem[];
};

export const DASHBOARD_ITEM: NavItem = {
  href: '/',
  labelKey: 'dashboard',
  permissions: [],
  icon: LayoutDashboard,
};

/**
 * Sidebar structure for Phases 1–2 (§2.14, §3.12 Required Screens).
 *
 * Items are filtered by permission so a Picker never sees the Companies entry.
 * This is presentation only — the database refuses the data regardless (§2.7).
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'administration',
    items: [
      { href: '/companies', labelKey: 'companies', permissions: ['companies.view'], icon: Building2 },
      { href: '/merchants', labelKey: 'merchants', permissions: ['merchants.view'], icon: Factory },
      { href: '/stores', labelKey: 'stores', permissions: ['stores.view'], icon: Store },
      { href: '/warehouses', labelKey: 'warehouses', permissions: ['warehouses.view'], icon: Warehouse },
    ],
  },
  {
    labelKey: 'catalogGroup',
    items: [
      { href: '/products', labelKey: 'products', permissions: ['products.view'], icon: Package },
      { href: '/products/unmapped', labelKey: 'unmappedProducts', permissions: ['products.view'], icon: Link2Off },
      { href: '/catalog', labelKey: 'catalog', permissions: ['products.view'], icon: Tags },
      { href: '/suppliers', labelKey: 'suppliers', permissions: ['suppliers.view'], icon: Truck },
      { href: '/price-history', labelKey: 'priceHistory', permissions: ['products.price.history'], icon: TrendingUp },
    ],
  },
  {
    labelKey: 'accessControl',
    items: [
      { href: '/users', labelKey: 'users', permissions: ['users.view'], icon: Users },
      { href: '/roles', labelKey: 'roles', permissions: ['roles.view', 'roles.manage'], icon: KeyRound },
      { href: '/roles/matrix', labelKey: 'permissionMatrix', permissions: ['roles.manage'], icon: ShieldCheck },
    ],
  },
  {
    labelKey: 'organisation',
    items: [
      { href: '/departments', labelKey: 'departments', permissions: ['departments.view', 'departments.manage'], icon: Network },
      { href: '/teams', labelKey: 'teams', permissions: ['teams.view', 'teams.manage'], icon: UsersRound },
      { href: '/shifts', labelKey: 'shifts', permissions: ['shifts.view', 'shifts.manage'], icon: CalendarClock },
    ],
  },
  {
    labelKey: 'ordersGroup',
    items: [
      { href: '/orders', labelKey: 'orders', permissions: ['orders.view'], icon: ShoppingCart },
      { href: '/confirmation', labelKey: 'confirmation', permissions: ['orders.view'], icon: PhoneCall },
      { href: '/customers', labelKey: 'customers', permissions: ['orders.customer.view'], icon: Contact },
      { href: '/duplicates', labelKey: 'duplicates', permissions: ['orders.duplicates.view'], icon: CopyCheck },
      { href: '/blacklist', labelKey: 'blacklist', permissions: ['orders.blacklist.view'], icon: ShieldBan },
      { href: '/cancellation-reasons', labelKey: 'cancellationReasons', permissions: ['orders.view'], icon: ListX },
      { href: '/message-templates', labelKey: 'messageTemplates', permissions: ['orders.view'], icon: MessageSquare },
    ],
  },
  {
    labelKey: 'warehouseGroup',
    items: [
      { href: '/inventory', labelKey: 'inventory', permissions: ['inventory.view'], icon: Boxes },
      { href: '/inventory/ledger', labelKey: 'inventoryLedger', permissions: ['inventory.ledger.view'], icon: ArrowLeftRight },
      { href: '/warehouse-tasks', labelKey: 'warehouseTasks', permissions: ['warehouse.tasks.view'], icon: ListChecks },
    ],
  },
  {
    labelKey: 'shippingGroup',
    items: [
      { href: '/shipments', labelKey: 'shipments', permissions: ['shipping.view'], icon: Send },
      { href: '/returns', labelKey: 'returns', permissions: ['returns.view'], icon: Undo2 },
      { href: '/collections', labelKey: 'collections', permissions: ['collections.view'], icon: Banknote },
    ],
  },
  {
    labelKey: 'financeGroup',
    items: [
      { href: '/expenses', labelKey: 'expenses', permissions: ['finance.expenses.view'], icon: Receipt },
      { href: '/settlements', labelKey: 'settlements', permissions: ['finance.settlement.view'], icon: Scale },
      { href: '/invoices', labelKey: 'invoices', permissions: ['finance.invoice.view'], icon: FileText },
      { href: '/profitability', labelKey: 'profitability', permissions: ['finance.profit.view'], icon: PiggyBank },
    ],
  },
  {
    labelKey: 'reportsGroup',
    items: [
      { href: '/reports', labelKey: 'reports', permissions: ['reports.view'], icon: BarChart3 },
    ],
  },
  {
    labelKey: 'monitoring',
    items: [
      { href: '/sync-log', labelKey: 'syncLog', permissions: ['stores.sync.view'], icon: RefreshCcw },
      { href: '/activity-log', labelKey: 'activityLog', permissions: ['audit.view'], icon: ScrollText },
      { href: '/approvals', labelKey: 'approvals', permissions: ['approvals.view'], icon: ClipboardCheck },
      { href: '/notifications', labelKey: 'notifications', permissions: [], icon: Bell },
    ],
  },
];
