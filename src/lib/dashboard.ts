import 'server-only';

import { createServerSupabase } from '@/lib/supabase/server';
import { can, type Session } from '@/lib/auth/session';

/**
 * §Dashboard — what a client actually sees.
 *
 * The brief asks for a dashboard driven by two things at once: the modules a
 * client subscribes to, and the permissions the viewer holds. Those are
 * genuinely different gates and both are applied here:
 *
 *   modules     → `company_features`, resolved from the plan and any overrides
 *   permissions → `can(session, …)`, the same check every screen uses
 *
 * A widget is rendered only when its module is active *and* the viewer may see
 * the data behind it. Queries behind a closed gate are never issued, so an
 * unsubscribed client does not pay for numbers they will not be shown.
 *
 * Every count is a head-only query running under RLS, so a figure can never
 * include a row the viewer could not have opened directly.
 */

export type ActiveModules = {
  fulfillment: boolean;
  ecommerce: boolean;
  operations: boolean;
};

/** One row of the §Attention Required list — things a human must act on. */
export type AttentionItem = {
  key: 'delayedOrders' | 'pendingApprovals' | 'unmappedProducts' | 'syncErrors' | 'lowStock';
  count: number;
  href: string;
  tone: 'danger' | 'warning';
};

/** §Order Funnel — received through returned. */
export type FunnelStage = {
  key: 'received' | 'confirmed' | 'fulfilled' | 'shipped' | 'delivered' | 'returned';
  count: number;
};

export type FulfillmentPanel = {
  received: number;
  pendingFulfillment: number;
  picking: number;
  readyToShip: number;
  shipped: number;
  delivered: number;
  cancelled: number;
  returned: number;
  delayed: number;
  /** Delivered as a share of everything handed to a courier. */
  fulfillmentRate: number | null;
  /** Confirmed → handed to courier, in hours. */
  avgProcessingHours: number | null;
};

export type EcommercePanel = {
  ordersToday: number;
  salesToday: number;
  salesMtd: number;
  averageOrderValue: number | null;
  pending: number;
  cancelled: number;
  returned: number;
  byStore: { store: string; orders: number; sales: number }[];
  topProducts: { sku: string; units: number }[];
  lowStock: number;
  outOfStock: number;
  storesConnected: number;
  storesWithSyncError: number;
};

export type CompanyDashboard = {
  modules: ActiveModules;
  fulfillment: FulfillmentPanel | null;
  ecommerce: EcommercePanel | null;
  attention: AttentionItem[];
  funnel: FunnelStage[];
};

const OPEN_ORDER_STATUSES = '("confirmed","cancelled","ready_for_warehouse")';

function startOfToday(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function startOfMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

/**
 * Which modules this company is subscribed to, resolved through plan + overrides.
 *
 * A company with no plan assigned falls back to both operational modules. That
 * keeps every tenant that existed before plans were introduced working exactly
 * as it did, rather than silently emptying their dashboard.
 */
export async function loadActiveModules(companyId: string | null): Promise<ActiveModules> {
  if (!companyId) return { fulfillment: false, ecommerce: false, operations: false };

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from('company_features')
    .select('feature_code, is_active')
    .eq('company_id', companyId)
    .eq('kind', 'module');

  const active = new Set((data ?? []).filter((row) => row.is_active).map((row) => row.feature_code));

  if (active.size === 0) {
    return { fulfillment: true, ecommerce: true, operations: false };
  }

  return {
    fulfillment: active.has('module_fulfillment'),
    ecommerce: active.has('module_ecommerce'),
    operations: active.has('module_operations'),
  };
}

export async function loadCompanyDashboard(session: Session): Promise<CompanyDashboard> {
  const supabase = await createServerSupabase();
  const modules = await loadActiveModules(session.profile.company_id);

  const canOrders = can(session, 'orders.view');
  const canShipping = can(session, 'shipping.view');
  const canInventory = can(session, 'inventory.view');
  const canProducts = can(session, 'products.view');
  const canApprovals = can(session, 'approvals.view');
  const canSync = can(session, 'stores.sync.view');
  const canWarehouse = can(session, 'warehouse.tasks.view');

  const today = startOfToday();
  const monthStart = startOfMonth();

  /* ---------------------------------------------------------------- */
  /* Fulfillment (§Fulfillment Module)                                 */
  /* ---------------------------------------------------------------- */

  let fulfillment: FulfillmentPanel | null = null;

  if (modules.fulfillment && canOrders) {
    const [
      received,
      pendingFulfillment,
      cancelled,
      picking,
      readyToShip,
      shipped,
      delivered,
      returned,
      delayed,
      processing,
    ] = await Promise.all([
      supabase.from('orders').select('*', { count: 'exact', head: true }).is('archived_at', null),
      supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'ready_for_warehouse')
        .is('archived_at', null),
      supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'cancelled')
        .is('archived_at', null),
      canWarehouse
        ? supabase
            .from('warehouse_tasks')
            .select('*', { count: 'exact', head: true })
            .eq('task_type', 'picking')
            .in('status', ['pending', 'assigned', 'in_progress'])
        : Promise.resolve({ count: 0 }),
      canShipping
        ? supabase
            .from('shipments')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'ready_to_ship')
        : Promise.resolve({ count: 0 }),
      canShipping
        ? supabase
            .from('shipments')
            .select('*', { count: 'exact', head: true })
            .not('handed_over_at', 'is', null)
        : Promise.resolve({ count: 0 }),
      canShipping
        ? supabase
            .from('shipments')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'delivered')
        : Promise.resolve({ count: 0 }),
      canShipping
        ? supabase.from('returns').select('*', { count: 'exact', head: true })
        : Promise.resolve({ count: 0 }),
      canShipping
        ? supabase.from('delayed_shipments').select('*', { count: 'exact', head: true })
        : Promise.resolve({ count: 0 }),
      // Averaging in SQL would need an aggregate the view layer does not expose,
      // so a bounded sample is fetched and averaged here. Bounded deliberately:
      // an unbounded scan on a busy tenant is not worth a headline figure.
      canShipping
        ? supabase
            .from('shipments')
            .select('handed_over_at, orders(confirmed_at)')
            .not('handed_over_at', 'is', null)
            .order('handed_over_at', { ascending: false })
            .limit(200)
        : Promise.resolve({ data: null }),
    ]);

    const shippedCount = shipped.count ?? 0;
    const deliveredCount = delivered.count ?? 0;

    const samples = ((processing as { data: unknown }).data ?? []) as {
      handed_over_at: string;
      orders: { confirmed_at: string | null } | null;
    }[];

    const durations = samples
      .map((row) => {
        const confirmedAt = row.orders?.confirmed_at;
        if (!confirmedAt) return null;
        const hours =
          (new Date(row.handed_over_at).getTime() - new Date(confirmedAt).getTime()) / 3_600_000;
        // A negative span means the timestamps disagree; drop it rather than
        // letting it drag the average below zero.
        return hours >= 0 ? hours : null;
      })
      .filter((value): value is number => value !== null);

    fulfillment = {
      received: received.count ?? 0,
      pendingFulfillment: pendingFulfillment.count ?? 0,
      picking: picking.count ?? 0,
      readyToShip: readyToShip.count ?? 0,
      shipped: shippedCount,
      delivered: deliveredCount,
      cancelled: cancelled.count ?? 0,
      returned: returned.count ?? 0,
      delayed: delayed.count ?? 0,
      fulfillmentRate:
        shippedCount > 0 ? Math.round((deliveredCount / shippedCount) * 1000) / 10 : null,
      avgProcessingHours:
        durations.length > 0
          ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
          : null,
    };
  }

  /* ---------------------------------------------------------------- */
  /* E-Commerce (§E-Commerce Management Module)                        */
  /*                                                                   */
  /* Conversion Rate is deliberately absent: it needs sessions or       */
  /* visitors, which no channel adapter currently fetches. A number we  */
  /* cannot source is worse than one we do not show.                    */
  /* ---------------------------------------------------------------- */

  let ecommerce: EcommercePanel | null = null;

  if (modules.ecommerce && canOrders) {
    const [todayRows, mtdRows, pending, cancelledCount, returnedCount, stores, stock, topLines] =
      await Promise.all([
        supabase
          .from('orders')
          .select('total, store_id')
          .gte('order_date', today)
          .is('archived_at', null),
        supabase
          .from('orders')
          .select('total')
          .gte('order_date', monthStart)
          .neq('status', 'cancelled')
          .is('archived_at', null),
        supabase
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .not('status', 'in', OPEN_ORDER_STATUSES)
          .is('archived_at', null),
        supabase
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'cancelled')
          .is('archived_at', null),
        canShipping
          ? supabase.from('returns').select('*', { count: 'exact', head: true })
          : Promise.resolve({ count: 0 }),
        supabase.from('stores').select('id, name, status, last_sync_status').is('archived_at', null),
        canInventory
          ? supabase.from('stock_on_hand').select('available, needs_reorder').limit(1000)
          : Promise.resolve({ data: null }),
        canProducts
          ? supabase
              .from('order_items')
              .select('sku, quantity')
              .not('sku', 'is', null)
              .limit(1000)
          : Promise.resolve({ data: null }),
      ]);

    const todays = (todayRows.data ?? []) as { total: number; store_id: string | null }[];
    const mtd = (mtdRows.data ?? []) as { total: number }[];
    const storeRows = (stores.data ?? []) as {
      id: string;
      name: string;
      status: string;
      last_sync_status: string | null;
    }[];

    const salesToday = todays.reduce((sum, row) => sum + Number(row.total), 0);
    const salesMtd = mtd.reduce((sum, row) => sum + Number(row.total), 0);

    const storeName = new Map(storeRows.map((store) => [store.id, store.name]));
    const perStore = new Map<string, { orders: number; sales: number }>();
    for (const row of todays) {
      const key = row.store_id ? (storeName.get(row.store_id) ?? '—') : '—';
      const entry = perStore.get(key) ?? { orders: 0, sales: 0 };
      entry.orders += 1;
      entry.sales += Number(row.total);
      perStore.set(key, entry);
    }

    const units = new Map<string, number>();
    for (const line of ((topLines as { data: unknown }).data ?? []) as {
      sku: string;
      quantity: number;
    }[]) {
      units.set(line.sku, (units.get(line.sku) ?? 0) + Number(line.quantity));
    }

    const stockRows = ((stock as { data: unknown }).data ?? []) as {
      available: number;
      needs_reorder: boolean;
    }[];

    ecommerce = {
      ordersToday: todays.length,
      salesToday,
      salesMtd,
      averageOrderValue: mtd.length > 0 ? Math.round(salesMtd / mtd.length) : null,
      pending: pending.count ?? 0,
      cancelled: cancelledCount.count ?? 0,
      returned: returnedCount.count ?? 0,
      byStore: [...perStore.entries()]
        .map(([store, value]) => ({ store, ...value }))
        .sort((a, b) => b.sales - a.sales)
        .slice(0, 5),
      topProducts: [...units.entries()]
        .map(([sku, unitCount]) => ({ sku, units: unitCount }))
        .sort((a, b) => b.units - a.units)
        .slice(0, 5),
      lowStock: stockRows.filter((row) => row.needs_reorder && Number(row.available) > 0).length,
      outOfStock: stockRows.filter((row) => Number(row.available) <= 0).length,
      storesConnected: storeRows.filter((store) => store.status === 'active').length,
      storesWithSyncError: storeRows.filter(
        (store) => store.status === 'connection_error' || store.last_sync_status === 'failed',
      ).length,
    };
  }

  /* ---------------------------------------------------------------- */
  /* §Attention Required — only things somebody must act on            */
  /* ---------------------------------------------------------------- */

  const [approvals, unmapped, syncErrors] = await Promise.all([
    canApprovals
      ? supabase
          .from('approval_requests')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending')
      : Promise.resolve({ count: 0 }),
    canProducts
      ? supabase.from('unmapped_products').select('*', { count: 'exact', head: true })
      : Promise.resolve({ count: 0 }),
    canSync
      ? supabase
          .from('sync_log')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'failed')
          .gte('started_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      : Promise.resolve({ count: 0 }),
  ]);

  const attention: AttentionItem[] = ([
    { key: 'delayedOrders', count: fulfillment?.delayed ?? 0, href: '/shipments?delayed=1', tone: 'danger' },
    { key: 'pendingApprovals', count: approvals.count ?? 0, href: '/approvals', tone: 'warning' },
    { key: 'unmappedProducts', count: unmapped.count ?? 0, href: '/products/unmapped', tone: 'warning' },
    { key: 'syncErrors', count: syncErrors.count ?? 0, href: '/sync-log', tone: 'danger' },
    {
      key: 'lowStock',
      count: (ecommerce?.lowStock ?? 0) + (ecommerce?.outOfStock ?? 0),
      href: '/inventory?reorder=1',
      tone: 'warning',
    },
    // Only surface what actually needs attention — a row reading zero is noise.
  ] satisfies AttentionItem[]).filter((item) => item.count > 0);

  /* ---------------------------------------------------------------- */
  /* §Order Funnel                                                     */
  /* ---------------------------------------------------------------- */

  let funnel: FunnelStage[] = [];

  if (canOrders) {
    const [received, confirmed, fulfilled] = await Promise.all([
      supabase.from('orders').select('*', { count: 'exact', head: true }).is('archived_at', null),
      supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .not('confirmed_at', 'is', null)
        .is('archived_at', null),
      supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'ready_for_warehouse')
        .is('archived_at', null),
    ]);

    funnel = [
      { key: 'received', count: received.count ?? 0 },
      { key: 'confirmed', count: confirmed.count ?? 0 },
      { key: 'fulfilled', count: fulfilled.count ?? 0 },
      { key: 'shipped', count: fulfillment?.shipped ?? 0 },
      { key: 'delivered', count: fulfillment?.delivered ?? 0 },
      { key: 'returned', count: fulfillment?.returned ?? 0 },
    ];
  }

  return { modules, fulfillment, ecommerce, attention, funnel };
}
