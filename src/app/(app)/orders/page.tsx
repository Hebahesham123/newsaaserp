import Link from 'next/link';
import type { Route } from 'next';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import {
  DateTime,
  Money,
  OrderSourceLabel,
  OrderStatusBadge,
  RiskBadge,
} from '@/components/status-badge';
import { searchTerm } from '@/lib/filters';
import {
  allowedOrderColumns,
  visibleOrderColumns,
  selectForColumns,
  type OrderColumn,
} from '@/lib/orders/columns';
import {
  allowedFilterFields,
  applyFilters,
  parseFilters,
  serializeFilter,
  dateRangeFilter,
  resolvePreset,
  OPERATORS_BY_TYPE,
  DATE_PRESETS,
  type ActiveFilter,
  type DatePreset,
} from '@/lib/orders/filters';
import { loadOrderSummary } from '@/lib/orders/summary';
import { OrderFilterBar, type ClientFilterField, type ClientChip } from './filter-bar';
import { ColumnPicker } from './column-picker';
import { OrderSelectionForm, CopyOrderNumber, RowCheckbox, type BulkOption } from './order-selection';
import { OrderForm } from './order-form';

const PAGE_SIZE = 25;

/**
 * §Order Listing Page.
 *
 * Assembled in the order the brief lays out: summary cards, then search and
 * filters, then selection, then the table itself. Every decision that depends
 * on who is looking — which cards, which columns, which filters, which bulk
 * actions — is made here on the server, so the browser is never sent a choice
 * the viewer is not allowed to make.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    f?: string | string[];
    preset?: string;
    from?: string;
    to?: string;
    dateField?: string;
    page?: string;
    archived?: string;
  }>;
}) {
  const session = await requirePermission('orders.view');
  const params = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  const companyId = session.profile.company_id;

  /* --- what this person may see ----------------------------------------- */

  // The preference table arrives with migration 0029. Until it is applied the
  // query errors, and the screen should fall back to its defaults rather than
  // refuse to render.
  const { data: preference } = await supabase
    .from('user_table_preferences')
    .select('columns')
    .eq('user_id', session.profile.id)
    .eq('screen', 'orders')
    .maybeSingle();

  const allowedColumns = allowedOrderColumns(session);
  const columns = visibleOrderColumns(session, preference?.columns as string[] | undefined);

  /* --- filters (§7) and the date range (§11) ------------------------------ */

  const filters: ActiveFilter[] = parseFilters(params.f, session);

  const dateFieldKey = params.dateField ?? 'order_date';
  const range = params.preset
    ? DATE_PRESETS.includes(params.preset as DatePreset)
      ? resolvePreset(params.preset as DatePreset)
      : null
    : params.from && params.to
      ? { from: params.from, to: params.to }
      : null;

  const rangeFilter = range ? dateRangeFilter(dateFieldKey, range.from, range.to) : null;
  const effective = rangeFilter ? [...filters, rangeFilter] : filters;

  /* --- the query ---------------------------------------------------------- */

  const from = Math.max(Number(params.page ?? 1), 1);
  const offset = (from - 1) * PAGE_SIZE;

  let query = supabase
    .from('orders')
    .select(selectForColumns(columns), { count: 'exact' })
    .order('order_date', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  if (companyId) query = query.eq('company_id', companyId);

  const term = searchTerm(params.q);
  if (term) {
    query = query.or(
      `order_number.ilike.%${term}%,customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%,external_order_number.ilike.%${term}%`,
    );
  }

  query = params.archived
    ? query.not('archived_at', 'is', null)
    : query.is('archived_at', null);

  query = applyFilters(query, effective);

  const [{ data: orders, count }, summary, { data: assignees }] = await Promise.all([
    query,
    loadOrderSummary(session, companyId),
    supabase
      .from('app_users')
      .select('id, full_name')
      .eq('status', 'active')
      .is('archived_at', null)
      .order('full_name')
      .limit(200),
  ]);

  const rows = (orders ?? []) as unknown as Record<string, unknown>[];

  /* --- what to hand the client components -------------------------------- */

  const clientFields: ClientFilterField[] = allowedFilterFields(session).map((field) => ({
    key: field.key,
    label: field.label(t),
    type: field.type,
    isDateField: field.isDateField,
    operators: OPERATORS_BY_TYPE[field.type].map((operator) => ({
      value: operator,
      label: t.filterOperator[operator],
    })),
    options: field.options?.map((value) => ({
      value,
      label: field.optionLabel ? field.optionLabel(value, t) : value,
    })),
  }));

  const chips: ClientChip[] = effective.map((filter) => ({
    raw: serializeFilter(filter),
    label: `${filter.field.label(t)} ${t.filterOperator[filter.operator]} ${
      filter.values
        .map((value) =>
          filter.field.optionLabel ? filter.field.optionLabel(value, t) : value,
        )
        .join(' – ') || '—'
    }`,
  }));

  const bulkOptions: BulkOption[] = [
    ...(can(session, 'orders.assign')
      ? [{ value: 'assign', label: t.orders.assign, needsAssignee: true }]
      : []),
    ...(can(session, 'orders.confirm')
      ? [{ value: 'confirmed', label: t.orders.confirm }]
      : []),
    ...(can(session, 'orders.cancel')
      ? [{ value: 'cancelled', label: t.orders.cancel, danger: true }]
      : []),
    ...(can(session, 'orders.release')
      ? [{ value: 'ready_for_warehouse', label: t.orders.release }]
      : []),
    ...(can(session, 'orders.edit') ? [{ value: 'tag', label: t.orders.tags, needsTag: true }] : []),
    ...(can(session, 'orders.archive')
      ? [{ value: 'archive', label: t.common.archive, danger: true }]
      : []),
  ];

  const exportHref = (() => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    for (const filter of effective) search.append('f', serializeFilter(filter));
    return `/orders/export${search.toString() ? `?${search}` : ''}`;
  })();

  const cardHref = (cardFilters: string[]) => {
    const search = new URLSearchParams();
    for (const entry of cardFilters) search.append('f', entry);
    return `/orders${search.toString() ? `?${search}` : ''}` as Route;
  };

  const totalPages = Math.max(Math.ceil((count ?? 0) / PAGE_SIZE), 1);
  const pageHref = (page: number) => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    for (const filter of filters) search.append('f', serializeFilter(filter));
    if (params.preset) search.set('preset', params.preset);
    if (params.dateField) search.set('dateField', params.dateField);
    if (page > 1) search.set('page', String(page));
    return `/orders${search.toString() ? `?${search}` : ''}` as Route;
  };

  return (
    <>
      <PageHeader
        title={t.orders.title}
        subtitle={t.orders.subtitle}
        actions={
          <>
            <ButtonLink href="/confirmation" variant="secondary">
              {t.orders.confirmationTitle}
            </ButtonLink>

            {can(session, 'orders.create') ? <OrderForm merchants={[]} stores={[]} /> : null}
          </>
        }
      />

      {/* §9 Role-based operational summary — what needs action now. */}
      {summary.length > 0 ? (
        <div className="mb-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {summary.map((card) => {
            const tile = (
              <StatTile
                label={card.label(t)}
                value={
                  card.isMoney
                    ? card.value.toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB')
                    : card.value
                }
                hint={card.isMoney ? (session.company?.base_currency ?? 'EGP') : undefined}
                tone={card.tone}
              />
            );

            // A card whose number cannot be reached by clicking is a number
            // nobody can act on — but only the ones backed by a filter can.
            return card.filters.length > 0 ? (
              <Link key={card.key} href={cardHref(card.filters)} className="block">
                {tile}
              </Link>
            ) : (
              <div key={card.key}>{tile}</div>
            );
          })}
        </div>
      ) : null}

      <OrderFilterBar
        fields={clientFields}
        chips={chips}
        presets={DATE_PRESETS.map((preset) => ({ value: preset, label: t.datePreset[preset] }))}
        searchValue={params.q ?? ''}
        labels={{
          addFilter: t.orders.addFilter,
          searchFilters: t.orders.searchFilters,
          apply: t.orders.apply,
          clearAll: t.orders.clearAll,
          dateRange: t.orders.dateRange,
          dateField: t.orders.dateField,
          customRange: t.orders.customRange,
          search: `${t.orders.orderNumber} / ${t.orders.phone}`,
        }}
      />

      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <ColumnPicker
          columns={allowedColumns.map((column) => ({
            key: column.key,
            label: column.label(t),
            checked: columns.some((visible) => visible.key === column.key),
          }))}
          labels={{
            customizeColumns: t.orders.customizeColumns,
            columnsHint: t.orders.columnsHint,
            apply: t.orders.apply,
            resetToDefault: t.orders.resetToDefault,
          }}
        />
        {can(session, 'orders.export') ? (
          <ButtonLink href={exportHref as Route} variant="secondary">
            {t.orders.exportOrders}
          </ButtonLink>
        ) : null}
      </div>

      <OrderSelectionForm
        options={bulkOptions}
        assignees={(assignees ?? []).map((user) => ({ id: user.id, name: user.full_name }))}
        labels={{
          selected: t.orders.selected,
          bulkActions: t.orders.bulkActions,
          apply: t.orders.apply,
          assignedTo: t.orders.assignedTo,
          tag: t.orders.tags,
        }}
      >
        <Card>
          {rows.length === 0 ? (
            <EmptyState title={t.orders.noOrders} hint={t.orders.subtitle} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th className="w-10" />
                  <Th className="w-16" />
                  {columns.map((column) => (
                    <Th key={column.key} className={column.align === 'end' ? 'text-end' : undefined}>
                      {column.label(t)}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((order) => (
                  <Tr key={String(order.id)}>
                    <Td>
                      <RowCheckbox id={String(order.id)} label={String(order.order_number)} />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-0.5">
                        <CopyOrderNumber
                          value={String(order.order_number)}
                          label={t.orders.copyOrderNumber}
                        />
                      </div>
                    </Td>
                    {columns.map((column) => (
                      <Td
                        key={column.key}
                        className={column.align === 'end' ? 'text-end' : undefined}
                      >
                        {renderCell(column, order, t, locale)}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </OrderSelectionForm>

      {rows.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-subtle">
          <span>
            {t.common.showing} {offset + 1}–{offset + rows.length} {t.common.of} {count ?? 0}
          </span>

          {totalPages > 1 ? (
            <div className="flex items-center gap-1">
              {from > 1 ? (
                <Link href={pageHref(from - 1)} className="rounded border border-border px-2 py-1 hover:bg-surface-muted">
                  ‹
                </Link>
              ) : null}
              <span className="px-2 tnum">
                {from} / {totalPages}
              </span>
              {from < totalPages ? (
                <Link href={pageHref(from + 1)} className="rounded border border-border px-2 py-1 hover:bg-surface-muted">
                  ›
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * One cell.
 *
 * Kept as a switch rather than a renderer per column: the set is closed, every
 * branch is two lines, and a table of render functions would be more machinery
 * than the problem has.
 */
function renderCell(
  column: OrderColumn,
  order: Record<string, unknown>,
  t: Awaited<ReturnType<typeof getDictionary>>,
  locale: string,
) {
  const embedded = <T,>(key: string): T | null => (order[key] as T) ?? null;

  switch (column.key) {
    case 'order_number':
      return (
        <span className="tnum font-medium" dir="ltr">
          <Link href={`/orders/${String(order.id)}` as Route} className="text-brand hover:underline">
            {String(order.order_number)}
          </Link>
          {order.is_duplicate ? (
            <Badge tone="warning" className="ms-2 text-[10px]">
              {t.orders.duplicate}
            </Badge>
          ) : null}
        </span>
      );

    case 'order_date':
      return <DateTime value={String(order.order_date)} />;

    case 'customer':
      return String(order.customer_name ?? '—');

    case 'phone':
      return (
        <span dir="ltr" className="tnum">
          {String(order.customer_phone ?? '—')}
        </span>
      );

    case 'company': {
      const company = embedded<{ name_en: string; name_ar: string }>('companies');
      return company ? (locale === 'ar' ? company.name_ar : company.name_en) : '—';
    }

    case 'merchant':
      return embedded<{ name: string }>('merchants')?.name ?? '—';

    case 'store':
      return embedded<{ name: string }>('stores')?.name ?? '—';

    case 'source':
      return <OrderSourceLabel source={order.source as never} />;

    case 'channel_order_number':
      return (
        <span dir="ltr" className="tnum text-ink-muted">
          {String(order.external_order_number ?? '—')}
        </span>
      );

    case 'governorate':
      return String(order.governorate ?? '—');

    case 'city':
      return String(order.city ?? '—');

    case 'items': {
      const items = order.order_items as { count: number }[] | null;
      return <span className="tnum">{items?.[0]?.count ?? 0}</span>;
    }

    case 'total':
      return <Money amount={order.total as number} currency={order.currency as string} />;

    case 'payment_method':
      return t.paymentMethod[order.payment_method as keyof typeof t.paymentMethod] ?? '—';

    case 'payment_status':
      return String(order.payment_status ?? '—');

    case 'status':
      return <OrderStatusBadge status={order.status as never} />;

    case 'stage':
      return t.orderStage[order.stage as keyof typeof t.orderStage] ?? '—';

    case 'fulfillment':
    case 'delivery_status': {
      const shipments = order.shipments as { status: string }[] | null;
      const status = shipments?.[0]?.status;
      return status ? (
        <Badge tone="info">{t.shipmentStatus[status as keyof typeof t.shipmentStatus] ?? status}</Badge>
      ) : (
        <span className="text-ink-subtle">—</span>
      );
    }

    case 'shipping_company': {
      const shipments = order.shipments as { couriers: { name: string } | null }[] | null;
      return shipments?.[0]?.couriers?.name ?? '—';
    }

    case 'tracking_number': {
      const shipments = order.shipments as { tracking_number: string | null }[] | null;
      return (
        <span dir="ltr" className="tnum text-ink-muted">
          {shipments?.[0]?.tracking_number ?? '—'}
        </span>
      );
    }

    case 'warehouse':
      return embedded<{ name: string }>('warehouses')?.name ?? '—';

    case 'assigned_to':
      return (
        embedded<{ full_name: string }>('app_users')?.full_name ?? (
          <span className="text-ink-subtle">{t.orders.unassigned}</span>
        )
      );

    case 'affiliate':
      return embedded<{ name: string }>('affiliates')?.name ?? '—';

    case 'calls':
      return <span className="tnum">{Number(order.call_attempts ?? 0)}</span>;

    case 'risk_score':
      return <RiskBadge score={order.risk_score as number} />;

    case 'last_action':
      return <DateTime value={String(order.updated_at)} />;

    case 'tags': {
      const tags = (order.tags ?? []) as string[];
      return tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 3).map((tag) => (
            <Badge key={tag} tone="neutral" className="text-[10px]">
              {tag}
            </Badge>
          ))}
        </div>
      ) : (
        <span className="text-ink-subtle">—</span>
      );
    }
  }
}
