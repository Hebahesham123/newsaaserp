import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, can, applyFieldPolicy } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  Badge,
  Breadcrumb,
  Card,
  CardBody,
  CardHeaderRow,
  Detail,
  DetailList,
  EmptyState,
  Notice,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import {
  CallOutcomeBadge,
  DateOnly,
  DateTime,
  Money,
  OrderStatusBadge,
  RiskBadge,
} from '@/components/status-badge';
import { CustomerForm } from '../../orders/settings-forms';

/**
 * §4.8 Customer 360°.
 *
 * "Before contacting the customer, all their data must appear on one screen."
 * The aggregates are columns maintained by trigger, so this page is one row
 * read plus the two history lists — not five aggregate queries.
 */
export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('orders.customer.view');
  const { id } = await params;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const { data: customer } = await supabase.from('customers').select('*').eq('id', id).maybeSingle();
  if (!customer) notFound();

  const [{ data: orders }, { data: calls }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, order_date, status, total, currency, source')
      .eq('customer_id', id)
      .order('order_date', { ascending: false })
      .limit(25),
    supabase
      .from('order_calls')
      .select('*, app_users(full_name), orders(order_number)')
      .eq('customer_id', id)
      .order('started_at', { ascending: false })
      .limit(15),
  ]);

  const canEdit = can(session, 'orders.customer.edit');
  const phone = applyFieldPolicy(session, 'customers', 'phone', customer.phone);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb items={[{ label: t.customers.title, href: '/customers' }, { label: customer.name }]} />
        }
        title={customer.name}
        subtitle={phone ?? undefined}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RiskBadge score={customer.risk_score} />
            {canEdit ? (
              <CustomerForm
                customer={{
                  id: customer.id,
                  name: customer.name,
                  phone: customer.phone,
                  alt_phone: customer.alt_phone,
                  email: customer.email,
                  governorate: customer.governorate,
                  city: customer.city,
                  address: customer.address,
                  preferred_language: customer.preferred_language,
                  notes: customer.notes,
                }}
              />
            ) : null}
          </div>
        }
      />

      {customer.is_blacklisted ? (
        <div className="mb-4">
          <Notice tone="danger" title={t.customers.blacklisted}>
            {customer.blacklist_reason ?? t.customers.riskExplain}
          </Notice>
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t.customers.ordersCount} value={customer.orders_count} tone="brand" />
        <StatTile label={t.customers.cancelledCount} value={customer.cancelled_count} tone="danger" />
        <StatTile label={t.customers.lifetimeValue} value={customer.lifetime_value} tone="success" />
        <StatTile label={t.customers.averageOrderValue} value={customer.average_order_value} tone="info" />
      </div>

      <div className="mb-4">
        <Notice tone="info">{t.customers.phaseFiveNote}</Notice>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeaderRow title={t.common.details} />
          <CardBody>
            <DetailList className="sm:grid-cols-1">
              <Detail label={t.orders.phone}>
                <span dir="ltr">{phone}</span>
              </Detail>
              <Detail label={t.orders.altPhone}>
                <span dir="ltr">{customer.alt_phone}</span>
              </Detail>
              <Detail label={t.common.email}>
                <span dir="ltr">{customer.email}</span>
              </Detail>
              <Detail label={t.orders.governorate}>{customer.governorate}</Detail>
              <Detail label={t.orders.city}>{customer.city}</Detail>
              <Detail label={t.orders.address}>{customer.address}</Detail>
              <Detail label={t.customers.preferredLanguage}>
                {customer.preferred_language === 'ar' ? 'العربية' : 'English'}
              </Detail>
              <Detail label={t.customers.lastOrder}>
                <DateOnly value={customer.last_order_at} />
              </Detail>
              <Detail label={t.customers.lastCall}>
                <DateTime value={customer.last_call_at} />
              </Detail>
              <Detail label={t.customers.lastMessage}>
                <DateTime value={customer.last_message_at} />
              </Detail>
              <Detail label={t.customers.blacklisted}>
                <Badge tone={customer.is_blacklisted ? 'danger' : 'success'}>
                  {customer.is_blacklisted ? t.customers.blacklisted : t.customers.notBlacklisted}
                </Badge>
              </Detail>
              <Detail label={t.common.notes}>{customer.notes}</Detail>
            </DetailList>
          </CardBody>
        </Card>

        <div className="grid gap-4 lg:col-span-2">
          <Card>
            <CardHeaderRow title={t.customers.previousOrders} />
            {!orders || orders.length === 0 ? (
              <EmptyState title={t.common.noResults} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t.orders.orderNumber}</Th>
                    <Th>{t.orders.orderDate}</Th>
                    <Th>{t.common.status}</Th>
                    <Th className="text-end">{t.orders.total}</Th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <Tr key={order.id}>
                      <Td className="tnum font-medium" dir="ltr">
                        <Link href={`/orders/${order.id}`} className="text-brand hover:underline">
                          {order.order_number}
                        </Link>
                      </Td>
                      <Td className="text-ink-muted">
                        <DateTime value={order.order_date} />
                      </Td>
                      <Td>
                        <OrderStatusBadge status={order.status} />
                      </Td>
                      <Td className="text-end">
                        <Money amount={order.total} currency={order.currency} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeaderRow title={t.orders.calls} hint={t.orders.callsSubtitle} />
            {!calls || calls.length === 0 ? (
              <EmptyState title={t.common.noResults} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t.audit.when}</Th>
                    <Th>{t.orders.orderNumber}</Th>
                    <Th>{t.orders.outcome}</Th>
                    <Th>{t.audit.actor}</Th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((call) => {
                    const agent = call.app_users as unknown as { full_name: string } | null;
                    const order = call.orders as unknown as { order_number: string } | null;

                    return (
                      <Tr key={call.id}>
                        <Td className="text-ink-muted">
                          <DateTime value={call.started_at} />
                        </Td>
                        <Td className="tnum" dir="ltr">
                          {order?.order_number ?? '—'}
                        </Td>
                        <Td>
                          <CallOutcomeBadge outcome={call.outcome} />
                        </Td>
                        <Td className="text-ink-muted">{agent?.full_name ?? '—'}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
