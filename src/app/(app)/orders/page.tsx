import Link from 'next/link';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import {
  DateTime,
  Money,
  OrderSourceLabel,
  OrderStatusBadge,
  RiskBadge,
} from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter, searchTerm } from '@/lib/filters';
import { OrderForm } from './order-form';

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

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    stage?: string;
    source?: string;
    mine?: string;
    archived?: string;
  }>;
}) {
  const session = await requirePermission('orders.view');
  const { q, status, stage, source, mine, archived } = await searchParams;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('orders')
    .select('*, merchants(name), stores(name), app_users!orders_assigned_to_fkey(full_name)')
    .order('order_date', { ascending: false })
    .limit(200);

  const term = searchTerm(q);
  if (term) {
    query = query.or(
      `order_number.ilike.%${term}%,customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%,external_order_number.ilike.%${term}%`,
    );
  }

  const statusFilter = pickFilter(status, ORDER_STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);

  const stageFilter = pickFilter(stage, ORDER_STAGES);
  if (stageFilter) query = query.eq('stage', stageFilter);

  const sourceFilter = pickFilter(source, ORDER_SOURCES);
  if (sourceFilter) query = query.eq('source', sourceFilter);

  if (mine) query = query.eq('assigned_to', session.profile.id);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);

  const [{ data: orders }, { data: merchants }, { data: stores }] = await Promise.all([
    query,
    supabase.from('merchants').select('id, name').is('archived_at', null).order('name'),
    supabase.from('stores').select('id, name').is('archived_at', null).order('name'),
  ]);

  const merchantOptions = (merchants ?? []).map((m) => ({ id: m.id, name: m.name }));
  const storeOptions = (stores ?? []).map((s) => ({ id: s.id, name: s.name }));

  const canCreate = can(session, 'orders.create');

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
            {canCreate ? <OrderForm merchants={merchantOptions} stores={storeOptions} /> : null}
          </>
        }
      />

      <Toolbar
        placeholder={`${t.orders.orderNumber} / ${t.orders.phone}`}
        filters={[
          {
            name: 'status',
            label: t.common.status,
            options: ORDER_STATUSES.map((value) => ({ value, label: t.orderStatus[value] })),
          },
          {
            name: 'stage',
            label: t.orders.stage,
            options: ORDER_STAGES.map((value) => ({ value, label: t.orderStage[value] })),
          },
          {
            name: 'source',
            label: t.orders.source,
            options: ORDER_SOURCES.map((value) => ({ value, label: t.orderSource[value] })),
          },
          { name: 'mine', label: t.orders.myQueue, options: [{ value: '1', label: t.common.yes }] },
          { name: 'archived', label: t.common.archived, options: [{ value: '1', label: t.common.yes }] },
        ]}
      />

      <Card>
        {!orders || orders.length === 0 ? (
          <EmptyState
            title={t.orders.noOrders}
            hint="Connect a store and run a sync, or create an order manually."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.orders.orderNumber}</Th>
                <Th>{t.orders.customer}</Th>
                <Th>{t.orders.source}</Th>
                <Th>{t.common.status}</Th>
                <Th className="text-end">{t.orders.total}</Th>
                <Th>{t.orders.assignedTo}</Th>
                <Th className="text-end">{t.orders.callAttempts}</Th>
                <Th className="text-end">{t.orders.riskScore}</Th>
                <Th>{t.orders.orderDate}</Th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const merchant = order.merchants as unknown as { name: string } | null;
                const agent = order.app_users as unknown as { full_name: string } | null;

                return (
                  <Tr key={order.id}>
                    <Td className="tnum font-medium" dir="ltr">
                      <Link href={`/orders/${order.id}`} className="text-brand hover:underline">
                        {order.order_number}
                      </Link>
                      {order.is_duplicate ? (
                        <Badge tone="warning" className="ms-2 text-[10px]">
                          {t.orders.duplicate}
                        </Badge>
                      ) : null}
                      {order.external_order_number ? (
                        <span className="block text-xs text-ink-subtle">
                          {order.external_order_number}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      {order.customer_name}
                      <span className="block text-xs text-ink-subtle" dir="ltr">
                        {order.customer_phone}
                      </span>
                    </Td>
                    <Td className="text-ink-muted">
                      <OrderSourceLabel source={order.source} />
                      {merchant ? (
                        <span className="block text-xs text-ink-subtle">{merchant.name}</span>
                      ) : null}
                    </Td>
                    <Td>
                      <OrderStatusBadge status={order.status} />
                    </Td>
                    <Td className="text-end">
                      <Money amount={order.total} currency={order.currency} />
                    </Td>
                    <Td className="text-ink-muted">
                      {agent?.full_name ?? (
                        <span className="text-ink-subtle">{t.orders.unassigned}</span>
                      )}
                    </Td>
                    <Td className="tnum text-end text-ink-muted">{order.call_attempts}</Td>
                    <Td className="text-end">
                      <RiskBadge score={order.risk_score} />
                    </Td>
                    <Td className="text-ink-muted">
                      <DateTime value={order.order_date} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {orders && orders.length > 0 ? (
        <p className="mt-3 text-xs text-ink-subtle">
          {t.common.showing} {orders.length} {t.common.results}
        </p>
      ) : null}
    </>
  );
}
