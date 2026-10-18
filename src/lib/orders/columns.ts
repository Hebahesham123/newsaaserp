import type { Dictionary } from '@/i18n/dictionaries/en';
import { can, type Session } from '@/lib/auth/session';

/**
 * §5 Order List Columns, §6 Customize Columns.
 *
 * One catalogue, two gates. A permission decides whether a column may be
 * offered at all; the person's saved preference decides which of the offered
 * ones they currently want. The brief is explicit that a column the role
 * forbids must not even appear inside Customize Columns, so the permission
 * filter runs first and the preference is applied to what survives.
 *
 * Both gates run on the server. A column the viewer may not see is never sent
 * to the browser, which is also what makes §12 Export safe: export reuses this
 * same list rather than re-deciding it, so a column that cannot be displayed
 * cannot be exported either.
 */

export type OrderColumnKey =
  | 'order_number'
  | 'order_date'
  | 'customer'
  | 'phone'
  | 'company'
  | 'merchant'
  | 'store'
  | 'source'
  | 'channel_order_number'
  | 'governorate'
  | 'city'
  | 'items'
  | 'total'
  | 'payment_method'
  | 'payment_status'
  | 'status'
  | 'stage'
  | 'fulfillment'
  | 'delivery_status'
  | 'shipping_company'
  | 'tracking_number'
  | 'warehouse'
  | 'assigned_to'
  | 'affiliate'
  | 'calls'
  | 'risk_score'
  | 'last_action'
  | 'tags';

export type OrderColumn = {
  key: OrderColumnKey;
  label: (t: Dictionary) => string;
  /** Required before the column is offered. Absent means every order viewer. */
  permission?: string;
  /** Only meaningful to someone who can see across companies. */
  platformOnly?: boolean;
  align?: 'end';
  /** Shown to someone who has never customised the table. */
  isDefault?: boolean;
};

/**
 * Declaration order is the fallback display order, so this list reads top to
 * bottom the way the table reads left to right.
 */
export const ORDER_COLUMNS: OrderColumn[] = [
  { key: 'order_number', label: (t) => t.orders.orderNumber, isDefault: true },
  { key: 'order_date', label: (t) => t.orders.orderDate, isDefault: true },
  { key: 'customer', label: (t) => t.orders.customer, isDefault: true },
  { key: 'phone', label: (t) => t.orders.phone, isDefault: true },
  { key: 'company', label: (t) => t.nav.companies, platformOnly: true },
  { key: 'merchant', label: (t) => t.orders.merchant, permission: 'merchants.view' },
  { key: 'store', label: (t) => t.nav.stores, isDefault: true },
  { key: 'source', label: (t) => t.orders.source, isDefault: true },
  { key: 'channel_order_number', label: (t) => t.orders.externalNumber },
  { key: 'governorate', label: (t) => t.orders.governorate },
  { key: 'city', label: (t) => t.orders.city },
  { key: 'items', label: (t) => t.orders.items, align: 'end', isDefault: true },
  { key: 'total', label: (t) => t.orders.total, align: 'end', isDefault: true },
  { key: 'payment_method', label: (t) => t.orders.paymentMethod },
  { key: 'payment_status', label: (t) => t.orders.paymentStatus, isDefault: true },
  { key: 'status', label: (t) => t.common.status, isDefault: true },
  { key: 'stage', label: (t) => t.orders.stage },
  { key: 'fulfillment', label: (t) => t.orders.fulfillmentStatus, permission: 'shipping.view' },
  { key: 'delivery_status', label: (t) => t.orders.deliveryStatus, permission: 'shipping.view' },
  { key: 'shipping_company', label: (t) => t.orders.shippingCompany, permission: 'shipping.view' },
  { key: 'tracking_number', label: (t) => t.orders.trackingNumber, permission: 'shipping.view' },
  { key: 'warehouse', label: (t) => t.nav.warehouses, permission: 'warehouses.view' },
  { key: 'assigned_to', label: (t) => t.orders.assignedTo, isDefault: true },
  { key: 'affiliate', label: (t) => t.orders.affiliate, permission: 'affiliates.view' },
  { key: 'calls', label: (t) => t.orders.callAttempts, align: 'end' },
  { key: 'risk_score', label: (t) => t.orders.riskScore, align: 'end' },
  { key: 'last_action', label: (t) => t.orders.lastAction },
  { key: 'tags', label: (t) => t.orders.tags },
];

const BY_KEY = new Map(ORDER_COLUMNS.map((column) => [column.key, column]));

/**
 * Every column this viewer is allowed to see, in catalogue order.
 *
 * This is what Customize Columns offers. Anything missing here is missing
 * because the role forbids it, which is why it is computed from the session
 * rather than filtered in the browser.
 */
export function allowedOrderColumns(session: Session): OrderColumn[] {
  const isPlatformAdmin = !session.profile.company_id;

  return ORDER_COLUMNS.filter((column) => {
    if (column.platformOnly && !isPlatformAdmin) return false;
    if (column.permission && !can(session, column.permission)) return false;
    return true;
  });
}

/**
 * What to actually render: the person's saved order, narrowed to what they may
 * see. An unknown or now-forbidden key in a stored preference is dropped rather
 * than treated as an error — roles change, and a stale preference should not
 * break the screen or leak a column the viewer has since lost.
 */
export function visibleOrderColumns(
  session: Session,
  preference: string[] | null | undefined,
): OrderColumn[] {
  const allowed = allowedOrderColumns(session);

  if (!preference || preference.length === 0) {
    const defaults = allowed.filter((column) => column.isDefault);
    // A role narrow enough to strip every default would otherwise render a
    // table with no columns at all.
    return defaults.length > 0 ? defaults : allowed.slice(0, 6);
  }

  const allowedKeys = new Set(allowed.map((column) => column.key));

  const chosen = preference
    .map((key) => BY_KEY.get(key as OrderColumnKey))
    .filter((column): column is OrderColumn => column !== undefined && allowedKeys.has(column.key));

  return chosen.length > 0 ? chosen : allowed.filter((column) => column.isDefault);
}

/**
 * The PostgREST select for a set of columns.
 *
 * Joins are requested only when a column needs them: a table showing neither
 * courier nor tracking should not pay for the shipments embed on every row.
 */
export function selectForColumns(columns: OrderColumn[]): string {
  const keys = new Set(columns.map((column) => column.key));
  const parts = [
    'id',
    'order_number',
    'order_date',
    'status',
    'stage',
    'total',
    'currency',
    'company_id',
    'is_duplicate',
    'archived_at',
  ];

  const add = (key: OrderColumnKey, ...fields: string[]) => {
    if (keys.has(key)) parts.push(...fields);
  };

  add('customer', 'customer_name');
  add('phone', 'customer_phone');
  add('source', 'source');
  add('channel_order_number', 'external_order_number');
  add('governorate', 'governorate');
  add('city', 'city');
  add('payment_method', 'payment_method');
  add('payment_status', 'payment_status');
  add('calls', 'call_attempts');
  add('risk_score', 'risk_score');
  add('last_action', 'updated_at');
  add('tags', 'tags');

  if (keys.has('merchant')) parts.push('merchants(name)');
  if (keys.has('store')) parts.push('stores(name)');
  if (keys.has('company')) parts.push('companies(name_en, name_ar)');
  if (keys.has('warehouse')) parts.push('warehouses(name)');
  if (keys.has('assigned_to')) parts.push('app_users!orders_assigned_to_fkey(full_name)');
  if (keys.has('affiliate')) parts.push('affiliates(name)');
  if (keys.has('items')) parts.push('order_items(count)');

  if (
    keys.has('fulfillment') ||
    keys.has('delivery_status') ||
    keys.has('shipping_company') ||
    keys.has('tracking_number')
  ) {
    parts.push('shipments(status, tracking_number, couriers(name))');
  }

  return parts.join(', ');
}
