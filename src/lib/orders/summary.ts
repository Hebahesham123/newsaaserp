import 'server-only';

import type { Dictionary } from '@/i18n/dictionaries/en';
import { can, type Session } from '@/lib/auth/session';
import { createServerSupabase } from '@/lib/supabase/server';
import type { OrderStatus, ShipmentStatus } from '@/lib/supabase/database.types';

/**
 * §9 Role-Based Operational Summary, §10 Data Scope by User Hierarchy.
 *
 * These cards answer "what needs action now?" — which the brief is careful to
 * separate from the KPI dashboard's "how is this person performing?". The
 * distinction is not cosmetic: a confirmation agent's card set is a worklist,
 * and putting an achievement percentage next to it would invite reading the
 * backlog as a judgement of the person looking at it.
 *
 * Which set appears is decided by what the viewer actually does, inferred from
 * the permissions they hold and the entity they belong to, because that is the
 * same thing their role already encodes. There is no second place to configure
 * it and get out of step.
 *
 * Every card carries the filter that produced it, so clicking one narrows the
 * table to exactly the rows it counted. A card whose number cannot be reached
 * by clicking is a number nobody can act on.
 */

export type SummaryCard = {
  key: string;
  label: (t: Dictionary) => string;
  value: number;
  /** Money rather than a count, so the UI formats it differently. */
  isMoney?: boolean;
  tone: 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'neutral';
  /** The `?f=` clauses this card stands for. Empty means "everything". */
  filters: string[];
};

type CardSet =
  | 'confirmation'
  | 'warehouse'
  | 'shipping'
  | 'affiliate'
  | 'entity'
  | 'general';

/**
 * The most specific set the viewer qualifies for.
 *
 * Order matters: an affiliate who somehow also holds shipping permissions is
 * still an affiliate, because their entity is the narrower fact about them.
 */
function cardSetFor(session: Session): CardSet {
  if (session.profile.affiliate_id) return 'affiliate';
  if (session.profile.merchant_id || session.profile.store_id) return 'entity';
  if (can(session, 'warehouse.tasks.view') && !can(session, 'orders.confirm')) return 'warehouse';
  if (can(session, 'shipping.view') && !can(session, 'orders.confirm')) return 'shipping';
  if (can(session, 'orders.confirm')) return 'confirmation';
  return 'general';
}

const CONFIRMED_STATUSES: OrderStatus[] = ['confirmed', 'ready_for_warehouse'];
const CALLING_STATUSES: OrderStatus[] = ['first_call', 'second_call', 'third_call', 'whatsapp_confirmation'];
const INTAKE_STATUSES: OrderStatus[] = ['new', 'imported', 'pending_review', 'pending_assignment', 'assigned'];

export async function loadOrderSummary(
  session: Session,
  companyId: string | null,
): Promise<SummaryCard[]> {
  if (!companyId) return [];

  const supabase = await createServerSupabase();
  const set = cardSetFor(session);

  const startOfToday = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  };

  /** A scoped head-only count. Every card is one of these. */
  const countOrders = async (
    build: (q: ReturnType<typeof ordersQuery>) => ReturnType<typeof ordersQuery>,
  ): Promise<number> => {
    const { count } = await build(ordersQuery());
    return count ?? 0;
  };

  function ordersQuery() {
    return supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId!)
      .is('archived_at', null);
  }

  const countShipments = async (statuses: ShipmentStatus[]): Promise<number> => {
    const { count } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .in('status', statuses);
    return count ?? 0;
  };

  if (set === 'confirmation') {
    const [pending, waiting, confirmedToday, cancelled, callbacks] = await Promise.all([
      countOrders((q) => q.in('status', INTAKE_STATUSES)),
      countOrders((q) => q.in('status', CALLING_STATUSES)),
      countOrders((q) => q.gte('confirmed_at', startOfToday())),
      countOrders((q) => q.eq('status', 'cancelled')),
      countOrders((q) => q.eq('status', 'callback')),
    ]);

    return [
      { key: 'pendingConfirmation', label: (t) => t.orders.myQueue, value: pending, tone: 'brand',
        filters: [`status:is_any_of:${INTAKE_STATUSES.join(',')}`] },
      { key: 'waiting', label: (t) => t.orders.calls, value: waiting, tone: 'warning',
        filters: [`status:is_any_of:${CALLING_STATUSES.join(',')}`] },
      { key: 'confirmedToday', label: (t) => t.orders.confirmed, value: confirmedToday, tone: 'success',
        filters: [`status:is_any_of:${CONFIRMED_STATUSES.join(',')}`] },
      { key: 'callbacks', label: (t) => t.orders.callbacksDue, value: callbacks, tone: 'info',
        filters: ['status:is:callback'] },
      { key: 'cancelled', label: (t) => t.orders.cancelled, value: cancelled, tone: 'danger',
        filters: ['status:is:cancelled'] },
    ];
  }

  if (set === 'warehouse') {
    const [readyToPrepare, picking, readyToShip, handed] = await Promise.all([
      countOrders((q) => q.eq('status', 'ready_for_warehouse')),
      supabase
        .from('warehouse_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('task_type', 'picking')
        .in('status', ['pending', 'assigned', 'in_progress'])
        .then((r) => r.count ?? 0),
      countShipments(['ready_to_ship']),
      countShipments(['handed_to_courier']),
    ]);

    return [
      { key: 'readyToPrepare', label: (t) => t.dashboard.pendingFulfillment, value: readyToPrepare, tone: 'brand',
        filters: ['status:is:ready_for_warehouse'] },
      { key: 'picking', label: (t) => t.dashboard.picking, value: picking, tone: 'info', filters: [] },
      { key: 'readyToShip', label: (t) => t.dashboard.readyToShip, value: readyToShip, tone: 'info', filters: [] },
      { key: 'handed', label: (t) => t.dashboard.shipped, value: handed, tone: 'neutral', filters: [] },
    ];
  }

  if (set === 'shipping') {
    const [shipped, inTransit, delivered, failed, returned] = await Promise.all([
      countShipments(['handed_to_courier']),
      countShipments(['in_transit', 'out_for_delivery']),
      countShipments(['delivered']),
      countShipments(['delivery_failed', 'second_attempt', 'third_attempt']),
      countShipments(['returned_to_warehouse', 'return_inspection']),
    ]);

    return [
      { key: 'shipped', label: (t) => t.dashboard.shipped, value: shipped, tone: 'brand', filters: [] },
      { key: 'inTransit', label: (t) => t.shipmentStatus.in_transit, value: inTransit, tone: 'info', filters: [] },
      { key: 'delivered', label: (t) => t.dashboard.delivered, value: delivered, tone: 'success', filters: [] },
      { key: 'failed', label: (t) => t.dashboard.delayedOrders, value: failed, tone: 'warning', filters: [] },
      { key: 'returned', label: (t) => t.dashboard.returned, value: returned, tone: 'danger', filters: [] },
    ];
  }

  if (set === 'affiliate') {
    const affiliateId = session.profile.affiliate_id!;

    const [total, pending, confirmed, cancelled, commissions] = await Promise.all([
      countOrders((q) => q.eq('affiliate_id', affiliateId)),
      countOrders((q) => q.eq('affiliate_id', affiliateId).in('status', INTAKE_STATUSES)),
      countOrders((q) => q.eq('affiliate_id', affiliateId).in('status', CONFIRMED_STATUSES)),
      countOrders((q) => q.eq('affiliate_id', affiliateId).eq('status', 'cancelled')),
      supabase
        .from('affiliate_commissions')
        .select('status, commission_amount')
        .eq('company_id', companyId)
        .eq('affiliate_id', affiliateId),
    ]);

    const rows = (commissions.data ?? []) as { status: string; commission_amount: number }[];
    const sumWhere = (status: string) =>
      rows
        .filter((row) => row.status === status)
        .reduce((sum, row) => sum + Number(row.commission_amount), 0);

    return [
      { key: 'total', label: (t) => t.orders.title, value: total, tone: 'brand', filters: [] },
      { key: 'pending', label: (t) => t.dashboard.pendingOrders, value: pending, tone: 'warning',
        filters: [`status:is_any_of:${INTAKE_STATUSES.join(',')}`] },
      { key: 'confirmed', label: (t) => t.orders.confirmed, value: confirmed, tone: 'success',
        filters: [`status:is_any_of:${CONFIRMED_STATUSES.join(',')}`] },
      { key: 'cancelled', label: (t) => t.orders.cancelled, value: cancelled, tone: 'danger',
        filters: ['status:is:cancelled'] },
      { key: 'pendingCommission', label: (t) => t.orders.pendingCommission, value: sumWhere('pending'),
        isMoney: true, tone: 'warning', filters: [] },
      { key: 'earnedCommission', label: (t) => t.orders.earnedCommission, value: sumWhere('payable') + sumWhere('paid'),
        isMoney: true, tone: 'success', filters: [] },
    ];
  }

  // Store, merchant, and anyone whose job is the whole funnel rather than one
  // stage of it.
  const [total, confirmed, cancelled, salesRows, returned] = await Promise.all([
    countOrders((q) => q),
    countOrders((q) => q.in('status', CONFIRMED_STATUSES)),
    countOrders((q) => q.eq('status', 'cancelled')),
    supabase
      .from('orders')
      .select('total')
      .eq('company_id', companyId)
      .neq('status', 'cancelled')
      .is('archived_at', null)
      .limit(2000),
    can(session, 'shipping.view')
      ? countShipments(['returned_to_warehouse', 'return_inspection'])
      : Promise.resolve(0),
  ]);

  const sales = ((salesRows.data ?? []) as { total: number }[]).reduce(
    (sum, row) => sum + Number(row.total),
    0,
  );

  return [
    { key: 'total', label: (t) => t.orders.title, value: total, tone: 'brand', filters: [] },
    { key: 'sales', label: (t) => t.dashboard.salesMtd, value: Math.round(sales), isMoney: true, tone: 'success', filters: [] },
    { key: 'confirmed', label: (t) => t.orders.confirmed, value: confirmed, tone: 'info',
      filters: [`status:is_any_of:${CONFIRMED_STATUSES.join(',')}`] },
    { key: 'cancelled', label: (t) => t.orders.cancelled, value: cancelled, tone: 'danger',
      filters: ['status:is:cancelled'] },
    ...(can(session, 'shipping.view')
      ? ([{ key: 'returned', label: (t: Dictionary) => t.dashboard.returned, value: returned, tone: 'warning' as const, filters: [] }])
      : []),
  ];
}
