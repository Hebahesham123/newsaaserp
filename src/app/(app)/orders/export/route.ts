import { NextResponse, type NextRequest } from 'next/server';
import { requirePermission } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { searchTerm } from '@/lib/filters';
import { visibleOrderColumns, selectForColumns, type OrderColumn } from '@/lib/orders/columns';
import { applyFilters, parseFilters } from '@/lib/orders/filters';

/**
 * §12 Export Orders.
 *
 * The brief's requirement is that an export can never contain something the
 * person could not have seen on screen. That is met by construction here: the
 * columns come from the same `visibleOrderColumns` the table uses, and the
 * filters from the same parser, which has already dropped any clause the
 * viewer's permissions forbid. There is no second definition of "what you may
 * export" to drift out of step with "what you may see".
 *
 * Three scopes from the brief:
 *   ids=…      the checkbox selection
 *   (default)  everything matching the current filters, across all pages
 *
 * Pagination deliberately does not apply. "Export all matching orders" is the
 * useful case, and silently exporting only the visible page would be the kind
 * of quiet wrongness nobody notices until the numbers are already in a report.
 */

/** Generous enough for a month of orders, bounded enough not to exhaust memory. */
const MAX_ROWS = 10_000;

export async function GET(request: NextRequest) {
  const session = await requirePermission('orders.export');
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const params = request.nextUrl.searchParams;

  const { data: preference } = await supabase
    .from('user_table_preferences')
    .select('columns')
    .eq('user_id', session.profile.id)
    .eq('screen', 'orders')
    .maybeSingle();

  const columns = visibleOrderColumns(session, preference?.columns as string[] | undefined);

  let query = supabase
    .from('orders')
    .select(selectForColumns(columns))
    .order('order_date', { ascending: false })
    .limit(MAX_ROWS);

  if (session.profile.company_id) {
    query = query.eq('company_id', session.profile.company_id);
  }

  const ids = params.get('ids');
  if (ids) {
    query = query.in('id', ids.split(',').filter(Boolean));
  } else {
    const term = searchTerm(params.get('q') ?? undefined);
    if (term) {
      query = query.or(
        `order_number.ilike.%${term}%,customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%,external_order_number.ilike.%${term}%`,
      );
    }
    query = query.is('archived_at', null);
    query = applyFilters(query, parseFilters(params.getAll('f'), session));
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  const header = columns.map((column) => column.label(t));
  const body = rows.map((order) => columns.map((column) => cellValue(column, order)));

  const csv = [header, ...body].map((line) => line.map(escapeCsv).join(',')).join('\r\n');

  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(
    // Excel reads a UTF-8 CSV as the system codepage unless the file opens with
    // a BOM, which turns every Arabic customer name into mojibake.
    '﻿' + csv,
    {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="orders-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    },
  );
}

/** A field that opens with =, +, - or @ is executed by Excel on open. */
function escapeCsv(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function cellValue(column: OrderColumn, order: Record<string, unknown>): string {
  const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));
  const embedded = <T,>(key: string): T | null => (order[key] as T) ?? null;

  switch (column.key) {
    case 'order_number':
      return text(order.order_number);
    case 'order_date':
      return text(order.order_date);
    case 'customer':
      return text(order.customer_name);
    case 'phone':
      return text(order.customer_phone);
    case 'company': {
      const company = embedded<{ name_en: string }>('companies');
      return company?.name_en ?? '';
    }
    case 'merchant':
      return embedded<{ name: string }>('merchants')?.name ?? '';
    case 'store':
      return embedded<{ name: string }>('stores')?.name ?? '';
    case 'source':
      return text(order.source);
    case 'channel_order_number':
      return text(order.external_order_number);
    case 'governorate':
      return text(order.governorate);
    case 'city':
      return text(order.city);
    case 'items': {
      const items = order.order_items as { count: number }[] | null;
      return String(items?.[0]?.count ?? 0);
    }
    case 'total':
      return text(order.total);
    case 'payment_method':
      return text(order.payment_method);
    case 'payment_status':
      return text(order.payment_status);
    case 'status':
      return text(order.status);
    case 'stage':
      return text(order.stage);
    case 'fulfillment':
    case 'delivery_status': {
      const shipments = order.shipments as { status: string }[] | null;
      return shipments?.[0]?.status ?? '';
    }
    case 'shipping_company': {
      const shipments = order.shipments as { couriers: { name: string } | null }[] | null;
      return shipments?.[0]?.couriers?.name ?? '';
    }
    case 'tracking_number': {
      const shipments = order.shipments as { tracking_number: string | null }[] | null;
      return shipments?.[0]?.tracking_number ?? '';
    }
    case 'warehouse':
      return embedded<{ name: string }>('warehouses')?.name ?? '';
    case 'assigned_to':
      return embedded<{ full_name: string }>('app_users')?.full_name ?? '';
    case 'affiliate':
      return embedded<{ name: string }>('affiliates')?.name ?? '';
    case 'calls':
      return text(order.call_attempts);
    case 'risk_score':
      return text(order.risk_score);
    case 'last_action':
      return text(order.updated_at);
    case 'tags':
      return ((order.tags ?? []) as string[]).join(' | ');
  }
}
