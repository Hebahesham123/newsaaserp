import type { Dictionary } from '@/i18n/dictionaries/en';
import { can, type Session } from '@/lib/auth/session';

/**
 * §7 Dynamic Advanced Filters, §11 Date Range.
 *
 * The brief replaces a fixed row of dropdowns with "select field, select
 * condition, select value", which means the set of conditions is a property of
 * the field's type rather than something written per field. That is the whole
 * reason this is a catalogue and not a hand-written form: adding a filterable
 * column should not mean deciding again what "is between" means.
 *
 * Filters live in the URL, one `f` parameter each:
 *
 *   ?f=status:is:confirmed&f=order_date:between:2026-09-01..2026-09-30
 *
 * In the URL rather than in component state, because the brief also asks for
 * saved views and shareable filtered lists. A filter you cannot put in a link
 * is a filter you cannot save or send to a colleague.
 */

export type FilterFieldType = 'select' | 'text' | 'number' | 'date' | 'boolean';

export type FilterOperator =
  | 'is'
  | 'is_not'
  | 'is_any_of'
  | 'is_none_of'
  | 'is_empty'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'before'
  | 'after'
  | 'between';

export type FilterField = {
  key: string;
  /** The database column it filters, which is not always the field's name. */
  column: string;
  label: (t: Dictionary) => string;
  type: FilterFieldType;
  permission?: string;
  /** Fixed choices. Dynamic ones (stores, users) are supplied by the page. */
  options?: readonly string[];
  /** Translates an option value for display. */
  optionLabel?: (value: string, t: Dictionary) => string;
  /** Offered in the §11 date-field selector. */
  isDateField?: boolean;
};

const ORDER_STATUSES = [
  'new', 'imported', 'pending_review',
  'duplicate_check', 'fraud_check', 'customer_history_review',
  'pending_assignment', 'assigned', 'first_call', 'second_call', 'third_call',
  'whatsapp_confirmation', 'callback', 'confirmed', 'cancelled',
  'ready_for_warehouse',
] as const;

const ORDER_STAGES = ['intake', 'verification', 'confirmation', 'warehouse'] as const;

const ORDER_SOURCES = [
  'shopify', 'woocommerce', 'amazon', 'noon', 'custom_api', 'mobile_app',
  'pos', 'excel_import', 'manual', 'social_commerce', 'whatsapp', 'call_center',
] as const;

const PAYMENT_METHODS = [
  'cod', 'card', 'wallet', 'bank_transfer', 'payment_link', 'installment', 'other',
] as const;

/** Which conditions a type admits. The UI reads this; it never hard-codes a list. */
export const OPERATORS_BY_TYPE: Record<FilterFieldType, FilterOperator[]> = {
  select: ['is', 'is_not', 'is_any_of', 'is_none_of', 'is_empty'],
  text: ['contains', 'is', 'is_not', 'is_empty'],
  number: ['is', 'gt', 'lt', 'between'],
  date: ['is', 'before', 'after', 'between'],
  boolean: ['is'],
};

/** Operators that take no value, so the UI hides the value control entirely. */
export const VALUELESS_OPERATORS: FilterOperator[] = ['is_empty'];

export const FILTER_FIELDS: FilterField[] = [
  {
    key: 'order_number',
    column: 'order_number',
    label: (t) => t.orders.orderNumber,
    type: 'text',
  },
  {
    key: 'customer',
    column: 'customer_name',
    label: (t) => t.orders.customer,
    type: 'text',
  },
  {
    key: 'phone',
    column: 'customer_phone',
    label: (t) => t.orders.phone,
    type: 'text',
  },
  {
    key: 'status',
    column: 'status',
    label: (t) => t.common.status,
    type: 'select',
    options: ORDER_STATUSES,
    optionLabel: (value, t) => t.orderStatus[value as keyof typeof t.orderStatus] ?? value,
  },
  {
    key: 'stage',
    column: 'stage',
    label: (t) => t.orders.stage,
    type: 'select',
    options: ORDER_STAGES,
    optionLabel: (value, t) => t.orderStage[value as keyof typeof t.orderStage] ?? value,
  },
  {
    key: 'source',
    column: 'source',
    label: (t) => t.orders.source,
    type: 'select',
    options: ORDER_SOURCES,
    optionLabel: (value, t) => t.orderSource[value as keyof typeof t.orderSource] ?? value,
  },
  {
    key: 'payment_method',
    column: 'payment_method',
    label: (t) => t.orders.paymentMethod,
    type: 'select',
    options: PAYMENT_METHODS,
    optionLabel: (value, t) => t.paymentMethod[value as keyof typeof t.paymentMethod] ?? value,
  },
  {
    key: 'payment_status',
    column: 'payment_status',
    label: (t) => t.orders.paymentStatus,
    type: 'text',
  },
  {
    key: 'store',
    column: 'store_id',
    label: (t) => t.nav.stores,
    type: 'select',
  },
  {
    key: 'merchant',
    column: 'merchant_id',
    label: (t) => t.orders.merchant,
    type: 'select',
    permission: 'merchants.view',
  },
  {
    key: 'warehouse',
    column: 'warehouse_id',
    label: (t) => t.nav.warehouses,
    type: 'select',
    permission: 'warehouses.view',
  },
  {
    key: 'assigned_to',
    column: 'assigned_to',
    label: (t) => t.orders.assignedTo,
    type: 'select',
  },
  {
    key: 'affiliate',
    column: 'affiliate_id',
    label: (t) => t.orders.affiliate,
    type: 'select',
    permission: 'affiliates.view',
  },
  {
    key: 'governorate',
    column: 'governorate',
    label: (t) => t.orders.governorate,
    type: 'text',
  },
  {
    key: 'city',
    column: 'city',
    label: (t) => t.orders.city,
    type: 'text',
  },
  {
    key: 'total',
    column: 'total',
    label: (t) => t.orders.total,
    type: 'number',
  },
  {
    key: 'risk_score',
    column: 'risk_score',
    label: (t) => t.orders.riskScore,
    type: 'number',
  },
  {
    key: 'call_attempts',
    column: 'call_attempts',
    label: (t) => t.orders.callAttempts,
    type: 'number',
  },
  {
    key: 'order_date',
    column: 'order_date',
    label: (t) => t.orders.orderDate,
    type: 'date',
    isDateField: true,
  },
  {
    key: 'confirmed_at',
    column: 'confirmed_at',
    label: (t) => t.orders.confirmationDate,
    type: 'date',
    isDateField: true,
  },
  {
    key: 'ready_at',
    column: 'ready_at',
    label: (t) => t.orders.readyDate,
    type: 'date',
    isDateField: true,
  },
  {
    key: 'last_action',
    column: 'updated_at',
    label: (t) => t.orders.lastAction,
    type: 'date',
    isDateField: true,
  },
];

const FIELD_BY_KEY = new Map(FILTER_FIELDS.map((field) => [field.key, field]));

/** Fields this viewer may filter on, which is also what the builder offers. */
export function allowedFilterFields(session: Session): FilterField[] {
  return FILTER_FIELDS.filter((field) => !field.permission || can(session, field.permission));
}

export type ActiveFilter = {
  field: FilterField;
  operator: FilterOperator;
  /** Empty for a valueless operator; two entries for `between`. */
  values: string[];
};

/**
 * Reads `?f=` into filters, dropping anything malformed or forbidden.
 *
 * Silent dropping is deliberate: a URL is user input, and a saved view written
 * before a permission was revoked must still open — just without the clause
 * the viewer may no longer use.
 */
export function parseFilters(
  raw: string | string[] | undefined,
  session: Session,
): ActiveFilter[] {
  if (!raw) return [];

  const allowed = new Set(allowedFilterFields(session).map((field) => field.key));
  const entries = Array.isArray(raw) ? raw : [raw];
  const parsed: ActiveFilter[] = [];

  for (const entry of entries) {
    // field:operator:value — the value may itself contain colons, so the split
    // is bounded rather than greedy.
    const firstColon = entry.indexOf(':');
    const secondColon = entry.indexOf(':', firstColon + 1);
    if (firstColon < 1) continue;

    const key = entry.slice(0, firstColon);
    const operator = (
      secondColon > -1 ? entry.slice(firstColon + 1, secondColon) : entry.slice(firstColon + 1)
    ) as FilterOperator;
    const rest = secondColon > -1 ? entry.slice(secondColon + 1) : '';

    const field = FIELD_BY_KEY.get(key);
    if (!field || !allowed.has(key)) continue;
    if (!OPERATORS_BY_TYPE[field.type].includes(operator)) continue;

    const values = VALUELESS_OPERATORS.includes(operator)
      ? []
      : operator === 'between'
        ? rest.split('..').slice(0, 2)
        : rest.split(',').filter(Boolean);

    if (!VALUELESS_OPERATORS.includes(operator) && values.length === 0) continue;
    if (operator === 'between' && values.length !== 2) continue;

    parsed.push({ field, operator, values });
  }

  return parsed;
}

/** The inverse, for building links that add or remove one clause. */
export function serializeFilter(filter: ActiveFilter): string {
  if (VALUELESS_OPERATORS.includes(filter.operator)) {
    return `${filter.field.key}:${filter.operator}`;
  }
  const value =
    filter.operator === 'between' ? filter.values.join('..') : filter.values.join(',');
  return `${filter.field.key}:${filter.operator}:${value}`;
}

/** A minimal structural type, so this module does not depend on the client's generics. */
type Filterable = {
  eq: (column: string, value: unknown) => Filterable;
  neq: (column: string, value: unknown) => Filterable;
  gt: (column: string, value: unknown) => Filterable;
  gte: (column: string, value: unknown) => Filterable;
  lt: (column: string, value: unknown) => Filterable;
  lte: (column: string, value: unknown) => Filterable;
  is: (column: string, value: unknown) => Filterable;
  in: (column: string, values: unknown[]) => Filterable;
  not: (column: string, operator: string, value: unknown) => Filterable;
  ilike: (column: string, pattern: string) => Filterable;
};

/**
 * Applies the clauses to a query.
 *
 * `between` on a date is inclusive of the whole closing day: a person choosing
 * 1–30 September means the 30th, not midnight at its start, and an exclusive
 * bound here silently loses a day of orders.
 */
export function applyFilters<T>(query: T, filters: ActiveFilter[]): T {
  // Cast rather than constrain: PostgREST's builder types each method against
  // the table's own column union, which no hand-written structural type can
  // satisfy. The clauses are validated against the catalogue above, so the
  // column names reaching the builder are already known-good.
  let result = query as unknown as Filterable;

  for (const { field, operator, values } of filters) {
    const column = field.column;
    const [first, second] = values;

    switch (operator) {
      case 'is':
        result = field.type === 'date'
          ? result.gte(column, first).lt(column, nextDay(first))
          : result.eq(column, first);
        break;
      case 'is_not':
        result = result.neq(column, first);
        break;
      case 'is_any_of':
        result = result.in(column, values);
        break;
      case 'is_none_of':
        result = result.not(column, 'in', `(${values.join(',')})`);
        break;
      case 'is_empty':
        result = result.is(column, null);
        break;
      case 'contains':
        result = result.ilike(column, `%${first}%`);
        break;
      case 'gt':
        result = result.gt(column, first);
        break;
      case 'lt':
        result = result.lt(column, first);
        break;
      case 'before':
        result = result.lt(column, first);
        break;
      case 'after':
        result = result.gte(column, nextDay(first));
        break;
      case 'between':
        result = field.type === 'date'
          ? result.gte(column, first).lt(column, nextDay(second))
          : result.gte(column, first).lte(column, second);
        break;
    }
  }

  return result as unknown as T;
}

/** The day after a yyyy-mm-dd date, used to make date bounds inclusive. */
function nextDay(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* §11 Date Range                                                              */
/* -------------------------------------------------------------------------- */

export const DATE_PRESETS = [
  'today',
  'yesterday',
  'last_7_days',
  'this_month',
  'last_month',
] as const;

export type DatePreset = (typeof DATE_PRESETS)[number];

/** Resolved against the server's clock once, so both bounds agree. */
export function resolvePreset(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const iso = (date: Date) => date.toISOString().slice(0, 10);

  switch (preset) {
    case 'today':
      return { from: iso(today), to: iso(today) };
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return { from: iso(yesterday), to: iso(yesterday) };
    }
    case 'last_7_days': {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { from: iso(start), to: iso(today) };
    }
    case 'this_month':
      return {
        from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: iso(today),
      };
    case 'last_month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: iso(start), to: iso(end) };
    }
  }
}

/**
 * Turns the date-range control into an ordinary `between` clause.
 *
 * Expressing it as a filter rather than a separate mechanism is what makes §11
 * "work together with the Dynamic Filter Builder and Saved Views" true by
 * construction: there is only one thing to save, and one thing to apply.
 */
export function dateRangeFilter(
  fieldKey: string,
  from: string,
  to: string,
): ActiveFilter | null {
  const field = FIELD_BY_KEY.get(fieldKey);
  if (!field || !field.isDateField || !from || !to) return null;
  return { field, operator: 'between', values: [from, to] };
}

export function dateFields(): FilterField[] {
  return FILTER_FIELDS.filter((field) => field.isDateField);
}
