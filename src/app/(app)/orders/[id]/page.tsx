import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, can, applyFieldPolicy } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
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
  OrderSourceLabel,
  OrderStageLabel,
  OrderStatusBadge,
  PaymentMethodLabel,
  RiskBadge,
} from '@/components/status-badge';
import { ActionButton } from '@/components/form/action-button';
import { OrderForm } from '../order-form';
import {
  AssignForm,
  CallForm,
  CancelForm,
  ItemForm,
  MessageForm,
  NoteForm,
  ReleaseForm,
  type Option,
} from './forms';
import {
  blacklistFromOrder,
  claimOrder,
  confirmOrder,
  removeOrderItem,
  resolveDuplicate,
} from '../actions';

/** Statuses past which the order is no longer being worked (§4.3). */
const DECIDED = ['confirmed', 'cancelled', 'ready_for_warehouse'];

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('orders.view');
  const { id } = await params;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  const { data: order } = await supabase
    .from('orders')
    .select(
      '*, merchants(name), stores(name), cancellation_reasons(name_en, name_ar), app_users!orders_assigned_to_fkey(id, full_name)',
    )
    .eq('id', id)
    .maybeSingle();

  if (!order) notFound();

  const canEdit = can(session, 'orders.edit');
  const canAssign = can(session, 'orders.assign');
  const canConfirm = can(session, 'orders.confirm');
  const canCancel = can(session, 'orders.cancel');
  const canRelease = can(session, 'orders.release');
  const canCall = can(session, 'orders.call.log');
  const canMessage = can(session, 'orders.message.send');
  const canRecording = can(session, 'orders.call.recording');
  const canCustomer = can(session, 'orders.customer.view');
  const canBlacklist = can(session, 'orders.blacklist.manage');

  const decided = DECIDED.includes(order.status);
  const lockedForWarehouse = order.status === 'ready_for_warehouse';

  const [
    { data: items },
    { data: calls },
    { data: messages },
    { data: events },
    customerResult,
    { data: reasons },
    { data: templates },
    { data: warehouses },
    { data: agents },
    { data: variants },
    duplicatesResult,
  ] = await Promise.all([
    supabase.from('order_items').select('*').eq('order_id', id).order('position'),
    supabase.from('order_calls').select('*, app_users(full_name)').eq('order_id', id).order('started_at', { ascending: false }),
    supabase.from('order_messages').select('*, app_users(full_name)').eq('order_id', id).order('created_at', { ascending: false }),
    supabase.from('order_events').select('*, app_users(full_name)').eq('order_id', id).order('created_at', { ascending: false }).limit(80),
    order.customer_id && canCustomer
      ? supabase.from('customers').select('*').eq('id', order.customer_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('cancellation_reasons').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('message_templates').select('code, name').eq('is_active', true).order('sort_order'),
    supabase.from('warehouses').select('id, name').is('archived_at', null).order('name'),
    supabase.from('app_users').select('id, full_name').eq('status', 'active').is('archived_at', null).order('full_name'),
    supabase
      .from('product_variants')
      .select('id, sku, name')
      .eq('merchant_id', order.merchant_id)
      .is('archived_at', null)
      .order('sku')
      .limit(300),
    order.is_duplicate
      ? supabase.rpc('find_duplicate_orders', { p_order_id: id })
      : Promise.resolve({ data: null }),
  ]);

  const customer = customerResult.data;
  const duplicates = duplicatesResult.data;

  const merchant = order.merchants as unknown as { name: string } | null;
  const store = order.stores as unknown as { name: string } | null;
  const assignee = order.app_users as unknown as { id: string; full_name: string } | null;
  const reason = order.cancellation_reasons as unknown as { name_en: string; name_ar: string } | null;

  // §2.7.3 — the phone is the field the spec singles out for masking, so it
  // goes through the field policy rather than being rendered raw.
  const phone = applyFieldPolicy(session, 'orders', 'customer_phone', order.customer_phone);

  const reasonOptions = (reasons ?? []).map((row) => ({
    id: row.id,
    name: locale === 'ar' ? row.name_ar : row.name_en,
    requiresNote: row.requires_note,
  }));
  const warehouseOptions: Option[] = (warehouses ?? []).map((w) => ({ id: w.id, name: w.name }));
  const agentOptions: Option[] = (agents ?? []).map((a) => ({ id: a.id, name: a.full_name }));
  const variantOptions: Option[] = (variants ?? []).map((v) => ({
    id: v.id,
    name: v.name ? `${v.sku} — ${v.name}` : v.sku,
  }));

  // §4.8 previous orders for the same customer, the panel an agent reads before
  // dialling.
  const { data: previousOrders } = order.customer_id
    ? await supabase
        .from('orders')
        .select('id, order_number, order_date, status, total, currency')
        .eq('customer_id', order.customer_id)
        .neq('id', id)
        .order('order_date', { ascending: false })
        .limit(8)
    : { data: null };

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb items={[{ label: t.orders.title, href: '/orders' }, { label: order.order_number }]} />
        }
        title={order.order_number}
        subtitle={`${order.customer_name} · ${phone ?? '—'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={order.status} />
            <Badge tone="neutral">
              <OrderStageLabel stage={order.stage} />
            </Badge>

            {!decided && canConfirm ? (
              <ActionButton
                action={confirmOrder}
                fields={{ id: order.id }}
                label={t.orders.confirm}
                icon="approve"
                variant="primary"
              />
            ) : null}

            {!decided && canCancel ? <CancelForm orderId={order.id} reasons={reasonOptions} /> : null}

            {order.status === 'confirmed' && canRelease ? (
              <ReleaseForm orderId={order.id} warehouses={warehouseOptions} confirmed />
            ) : null}

            {!decided && canAssign ? <AssignForm orderId={order.id} agents={agentOptions} /> : null}

            {!decided && !order.assigned_to ? (
              <ActionButton
                action={claimOrder}
                fields={{ id: order.id }}
                label={t.orders.assignToMe}
                variant="secondary"
              />
            ) : null}

            {canEdit ? (
              <OrderForm
                order={{
                  id: order.id,
                  merchant_id: order.merchant_id,
                  store_id: order.store_id,
                  source: order.source,
                  external_order_number: order.external_order_number,
                  customer_name: order.customer_name,
                  customer_phone: order.customer_phone,
                  customer_alt_phone: order.customer_alt_phone,
                  customer_email: order.customer_email,
                  governorate: order.governorate,
                  city: order.city,
                  address: order.address,
                  address_notes: order.address_notes,
                  maps_url: order.maps_url,
                  payment_method: order.payment_method,
                  payment_status: order.payment_status,
                  currency: order.currency,
                  shipping_fees: order.shipping_fees,
                  notes: order.notes,
                  internal_notes: order.internal_notes,
                }}
                merchants={merchant ? [{ id: order.merchant_id, name: merchant.name }] : []}
                stores={store && order.store_id ? [{ id: order.store_id, name: store.name }] : []}
                locked={lockedForWarehouse}
              />
            ) : null}
          </div>
        }
      />

      {/* §4.13 the warning an agent must see before they call. */}
      {order.risk_score >= 60 ? (
        <div className="mb-4">
          <Notice tone="danger" title={t.orders.riskHigh}>
            {t.customers.riskExplain}
          </Notice>
        </div>
      ) : null}

      {order.is_duplicate ? (
        <div className="mb-4">
          <Notice tone="warning" title={t.orders.duplicate}>
            <div className="flex flex-wrap items-center gap-3">
              <span>{t.orders.duplicatesSubtitle}</span>
              {order.duplicate_of_id ? (
                <Link href={`/orders/${order.duplicate_of_id}`} className="underline">
                  {t.orders.duplicateOf}
                </Link>
              ) : null}
              {canEdit ? (
                <ActionButton
                  action={resolveDuplicate}
                  fields={{ id: order.id }}
                  label={t.common.no}
                  variant="secondary"
                  size="sm"
                />
              ) : null}
            </div>
          </Notice>
        </div>
      ) : null}

      {lockedForWarehouse ? (
        <div className="mb-4">
          <Notice tone="info">{t.orders.warehouseLocked}</Notice>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ================================================================ */}
        {/* Customer 360° — §4.8                                             */}
        {/* ================================================================ */}
        <div className="grid gap-4 lg:col-span-1">
          <Card>
            <CardHeaderRow title={t.orders.customer}>
              {order.customer_id && canCustomer ? (
                <Link href={`/customers/${order.customer_id}`} className="text-xs text-brand hover:underline">
                  {t.customers.customer360}
                </Link>
              ) : null}
            </CardHeaderRow>
            <CardBody>
              <DetailList className="sm:grid-cols-1">
                <Detail label={t.orders.customerName}>{order.customer_name}</Detail>
                <Detail label={t.orders.phone}>
                  <span dir="ltr">{phone}</span>
                </Detail>
                <Detail label={t.orders.altPhone}>
                  <span dir="ltr">{order.customer_alt_phone}</span>
                </Detail>
                <Detail label={t.common.email}>
                  <span dir="ltr">{order.customer_email}</span>
                </Detail>
                <Detail label={t.orders.governorate}>{order.governorate}</Detail>
                <Detail label={t.orders.city}>{order.city}</Detail>
                <Detail label={t.orders.address}>{order.address}</Detail>
                <Detail label={t.orders.addressNotes}>{order.address_notes}</Detail>
                <Detail label={t.orders.mapsLocation}>
                  {order.maps_url ? (
                    <a href={order.maps_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                      {t.common.seeDetails}
                    </a>
                  ) : null}
                </Detail>
                <Detail label={t.orders.riskScore}>
                  <RiskBadge score={order.risk_score} />
                </Detail>
              </DetailList>

              {canBlacklist && !decided ? (
                <div className="mt-3 border-t border-border pt-3">
                  <ActionButton
                    action={blacklistFromOrder}
                    fields={{ id: order.id, reason: `Blacklisted from order ${order.order_number}` }}
                    label={t.blacklist.createTitle}
                    variant="ghost"
                    size="sm"
                    confirm={t.common.confirm}
                  />
                </div>
              ) : null}
            </CardBody>
          </Card>

          {customer ? (
            <Card>
              <CardHeaderRow title={t.customers.customer360} hint={t.customers.phaseFiveNote} />
              <CardBody>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label={t.customers.ordersCount} value={customer.orders_count} tone="brand" />
                  <StatTile label={t.customers.cancelledCount} value={customer.cancelled_count} tone="danger" />
                  <StatTile
                    label={t.customers.lifetimeValue}
                    value={customer.lifetime_value}
                    hint={order.currency}
                    tone="success"
                  />
                  <StatTile
                    label={t.customers.averageOrderValue}
                    value={customer.average_order_value}
                    hint={order.currency}
                    tone="info"
                  />
                </div>
                <DetailList className="mt-3 sm:grid-cols-1">
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
          ) : null}

          {previousOrders && previousOrders.length > 0 ? (
            <Card>
              <CardHeaderRow title={t.customers.previousOrders} />
              <Table>
                <tbody>
                  {previousOrders.map((previous) => (
                    <Tr key={previous.id}>
                      <Td className="tnum" dir="ltr">
                        <Link href={`/orders/${previous.id}`} className="text-brand hover:underline">
                          {previous.order_number}
                        </Link>
                        <span className="block text-xs text-ink-subtle">
                          <DateOnly value={previous.order_date} />
                        </span>
                      </Td>
                      <Td>
                        <OrderStatusBadge status={previous.status} />
                      </Td>
                      <Td className="text-end">
                        <Money amount={previous.total} currency={previous.currency} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </div>

        {/* ================================================================ */}
        {/* Order workspace                                                  */}
        {/* ================================================================ */}
        <div className="grid gap-4 lg:col-span-2">
          <Card>
            <CardHeaderRow title={t.common.details} />
            <CardBody>
              <DetailList>
                <Detail label={t.orders.source}>
                  <OrderSourceLabel source={order.source} />
                </Detail>
                <Detail label={t.orders.externalNumber}>{order.external_order_number}</Detail>
                <Detail label={t.stores.merchant}>{merchant?.name}</Detail>
                <Detail label={t.nav.stores}>{store?.name}</Detail>
                <Detail label={t.orders.orderDate}>
                  <DateTime value={order.order_date} />
                </Detail>
                <Detail label={t.orders.assignedTo}>
                  {assignee?.full_name ?? <span className="text-ink-subtle">{t.orders.unassigned}</span>}
                </Detail>
                <Detail label={t.orders.paymentMethod}>
                  <PaymentMethodLabel method={order.payment_method} />
                </Detail>
                <Detail label={t.orders.paymentStatus}>
                  <Badge tone={order.payment_status === 'paid' ? 'success' : 'neutral'}>
                    {t.paymentStatus[order.payment_status as keyof typeof t.paymentStatus] ?? order.payment_status}
                  </Badge>
                </Detail>
                <Detail label={t.orders.codAmount}>
                  <Money amount={order.cod_amount} currency={order.currency} />
                </Detail>
                <Detail label={t.orders.confirmed}>
                  <DateTime value={order.confirmed_at} />
                </Detail>
                {order.status === 'cancelled' ? (
                  <>
                    <Detail label={t.orders.cancellationReason}>
                      {reason ? (locale === 'ar' ? reason.name_ar : reason.name_en) : null}
                    </Detail>
                    <Detail label={t.orders.cancellationNote}>{order.cancellation_note}</Detail>
                  </>
                ) : null}
                <Detail label={t.orders.customerNotes}>{order.notes}</Detail>
                <Detail label={t.orders.internalNotes}>{order.internal_notes}</Detail>
              </DetailList>
            </CardBody>
          </Card>

          {/* ------------------------------------------------------------ */}
          {/* Products — §4.4                                              */}
          {/* ------------------------------------------------------------ */}
          <Card>
            <CardHeaderRow title={t.orders.items} hint={t.orders.itemsSubtitle}>
              {canEdit ? (
                <ItemForm orderId={order.id} variants={variantOptions} locked={lockedForWarehouse} />
              ) : null}
            </CardHeaderRow>
            {!items || items.length === 0 ? (
              <EmptyState title={t.common.noResults} hint={t.orders.itemsSubtitle} />
            ) : (
              <>
                <Table>
                  <thead>
                    <tr>
                      <Th>{t.common.name}</Th>
                      <Th className="text-end">{t.orders.quantity}</Th>
                      <Th className="text-end">{t.orders.unitPrice}</Th>
                      <Th className="text-end">{t.orders.discount}</Th>
                      <Th className="text-end">{t.orders.lineTotal}</Th>
                      {canEdit ? <Th className="text-end">{t.common.actions}</Th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <Tr key={item.id}>
                        <Td>
                          {item.name}
                          {item.sku ? (
                            <span className="block text-xs text-ink-subtle" dir="ltr">
                              {item.sku}
                            </span>
                          ) : null}
                          {!item.variant_id ? (
                            <Badge tone="warning" className="mt-1 text-[10px]">
                              {t.mappingStatus.unmapped}
                            </Badge>
                          ) : null}
                        </Td>
                        <Td className="tnum text-end">{item.quantity}</Td>
                        <Td className="text-end">
                          <Money amount={item.unit_price} currency={order.currency} />
                        </Td>
                        <Td className="text-end text-ink-muted">
                          <Money amount={item.discount} currency={order.currency} />
                        </Td>
                        <Td className="text-end font-medium">
                          <Money amount={item.total} currency={order.currency} />
                        </Td>
                        {canEdit ? (
                          <Td>
                            <div className="flex items-center justify-end gap-1">
                              <ItemForm
                                orderId={order.id}
                                variants={variantOptions}
                                locked={lockedForWarehouse}
                                item={{
                                  id: item.id,
                                  variant_id: item.variant_id,
                                  sku: item.sku,
                                  name: item.name,
                                  quantity: item.quantity,
                                  unit_price: item.unit_price,
                                  discount: item.discount,
                                  tax: item.tax,
                                  notes: item.notes,
                                }}
                              />
                              <ActionButton
                                action={removeOrderItem}
                                fields={{ id: item.id, order_id: order.id }}
                                label={t.common.remove}
                                icon="reject"
                                confirm={t.common.confirm}
                                iconOnly
                              />
                            </div>
                          </Td>
                        ) : null}
                      </Tr>
                    ))}
                  </tbody>
                </Table>

                <CardBody className="border-t border-border">
                  <DetailList>
                    <Detail label={t.orders.subtotal}>
                      <Money amount={order.subtotal} currency={order.currency} />
                    </Detail>
                    <Detail label={t.orders.discount}>
                      <Money amount={order.discount_total} currency={order.currency} />
                    </Detail>
                    <Detail label={t.orders.shippingFees}>
                      <Money amount={order.shipping_fees} currency={order.currency} />
                    </Detail>
                    <Detail label={t.orders.total}>
                      <span className="text-base font-semibold">
                        <Money amount={order.total} currency={order.currency} />
                      </span>
                    </Detail>
                  </DetailList>
                </CardBody>
              </>
            )}
          </Card>

          {/* ------------------------------------------------------------ */}
          {/* Calls — §4.10                                                */}
          {/* ------------------------------------------------------------ */}
          <Card>
            <CardHeaderRow title={t.orders.calls} hint={t.orders.callsSubtitle}>
              {canCall && !decided ? (
                <CallForm orderId={order.id} phone={order.customer_phone} attempt={order.call_attempts} />
              ) : null}
            </CardHeaderRow>
            {!calls || calls.length === 0 ? (
              <EmptyState title={t.common.noResults} hint={t.orders.callsSubtitle} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th className="text-end">{t.orders.attempt}</Th>
                    <Th>{t.audit.when}</Th>
                    <Th>{t.orders.outcome}</Th>
                    <Th className="text-end">{t.orders.duration}</Th>
                    <Th>{t.audit.actor}</Th>
                    <Th>{t.common.notes}</Th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((call) => {
                    const agent = call.app_users as unknown as { full_name: string } | null;
                    return (
                      <Tr key={call.id}>
                        <Td className="tnum text-end">{call.attempt_number}</Td>
                        <Td className="text-ink-muted">
                          <DateTime value={call.started_at} />
                        </Td>
                        <Td>
                          <CallOutcomeBadge outcome={call.outcome} />
                          {call.callback_at ? (
                            <span className="block text-xs text-ink-subtle">
                              {t.orders.callbackAt}: <DateTime value={call.callback_at} />
                            </span>
                          ) : null}
                        </Td>
                        <Td className="tnum text-end text-ink-muted">
                          {call.duration_seconds != null ? `${call.duration_seconds}s` : '—'}
                        </Td>
                        <Td className="text-ink-muted">{agent?.full_name ?? '—'}</Td>
                        <Td className="text-xs text-ink-muted">
                          {call.notes ?? '—'}
                          {call.recording_url && canRecording ? (
                            <a
                              href={call.recording_url}
                              target="_blank"
                              rel="noreferrer"
                              className="ms-2 text-brand hover:underline"
                            >
                              {t.orders.recording}
                            </a>
                          ) : null}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          {/* ------------------------------------------------------------ */}
          {/* WhatsApp — §4.9                                              */}
          {/* ------------------------------------------------------------ */}
          <Card>
            <CardHeaderRow title={t.orders.messages} hint={t.orders.messagesSubtitle}>
              {canMessage && !decided ? (
                <MessageForm
                  orderId={order.id}
                  templates={templates ?? []}
                  language={locale}
                />
              ) : null}
            </CardHeaderRow>
            {!messages || messages.length === 0 ? (
              <EmptyState title={t.common.noResults} hint={t.orders.messagesSubtitle} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t.audit.when}</Th>
                    <Th>{t.orders.template}</Th>
                    <Th>{t.orders.messageBody}</Th>
                    <Th>{t.common.status}</Th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((message) => (
                    <Tr key={message.id}>
                      <Td className="text-ink-muted">
                        <DateTime value={message.created_at} />
                      </Td>
                      <Td className="text-ink-muted">{message.template_code ?? '—'}</Td>
                      <Td className="max-w-md text-xs">{message.body}</Td>
                      <Td>
                        <Badge tone={message.status === 'failed' ? 'danger' : 'info'}>
                          {t.messageStatus[message.status as keyof typeof t.messageStatus] ?? message.status}
                        </Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {/* ------------------------------------------------------------ */}
          {/* Duplicates — §4.12                                           */}
          {/* ------------------------------------------------------------ */}
          {duplicates && duplicates.length > 0 ? (
            <Card>
              <CardHeaderRow title={t.orders.duplicatesTitle} hint={t.orders.duplicatesSubtitle} />
              <Table>
                <thead>
                  <tr>
                    <Th>{t.orders.orderNumber}</Th>
                    <Th>{t.orders.orderDate}</Th>
                    <Th>{t.common.status}</Th>
                    <Th>{t.orders.matchReason}</Th>
                  </tr>
                </thead>
                <tbody>
                  {duplicates.map((duplicate) => (
                    <Tr key={duplicate.order_id}>
                      <Td className="tnum" dir="ltr">
                        <Link href={`/orders/${duplicate.order_id}`} className="text-brand hover:underline">
                          {duplicate.order_number}
                        </Link>
                      </Td>
                      <Td className="text-ink-muted">
                        <DateTime value={duplicate.order_date} />
                      </Td>
                      <Td>
                        <OrderStatusBadge status={duplicate.status} />
                      </Td>
                      <Td className="text-xs text-ink-muted">{duplicate.match_reason ?? '—'}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}

          {/* ------------------------------------------------------------ */}
          {/* Timeline — §4.15 rule 4                                      */}
          {/* ------------------------------------------------------------ */}
          <Card>
            <CardHeaderRow title={t.orders.timeline} hint={t.orders.timelineSubtitle}>
              <NoteForm orderId={order.id} />
            </CardHeaderRow>
            {!events || events.length === 0 ? (
              <EmptyState title={t.common.noResults} />
            ) : (
              <CardBody>
                <ol className="relative space-y-4 border-s border-border ps-5">
                  {events.map((event) => {
                    const actor = event.app_users as unknown as { full_name: string } | null;
                    return (
                      <li key={event.id} className="relative">
                        <span className="absolute -start-[1.4rem] top-1.5 size-2 rounded-full bg-brand" aria-hidden />
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-sm font-medium text-ink">
                            {t.orderEventType[event.event_type as keyof typeof t.orderEventType] ??
                              event.event_type}
                          </span>
                          {event.from_status && event.to_status ? (
                            <span className="text-xs text-ink-subtle">
                              {t.orderStatus[event.from_status as keyof typeof t.orderStatus]} →{' '}
                              {t.orderStatus[event.to_status as keyof typeof t.orderStatus]}
                            </span>
                          ) : null}
                          <span className="ms-auto text-xs text-ink-subtle">
                            <DateTime value={event.created_at} />
                          </span>
                        </div>
                        {event.summary ? (
                          <p className="mt-0.5 text-sm text-ink-muted">{event.summary}</p>
                        ) : null}
                        <p className="text-xs text-ink-subtle">{actor?.full_name ?? '—'}</p>
                      </li>
                    );
                  })}
                </ol>
              </CardBody>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
