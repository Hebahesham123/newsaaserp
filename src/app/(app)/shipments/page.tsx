import Link from 'next/link';
import { requirePermission } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, Notice, PageHeader, StatTile, Table, Td, Th, Tr } from '@/components/ui';
import { DateTime, EnumBadge, Money } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter, searchTerm } from '@/lib/filters';

const SHIPMENT_STATUSES = [
  'ready_to_ship', 'handed_to_courier', 'in_transit', 'out_for_delivery',
  'delivered', 'delivery_failed', 'second_attempt', 'third_attempt',
  'returned_to_warehouse', 'return_inspection', 'inventory_updated',
  'closed', 'cancelled', 'lost',
] as const;

/** §6.3 / §6.4 the shipment follow-up screen. */
export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; courier?: string; delayed?: string }>;
}) {
  await requirePermission('shipping.view');
  const { q, status, courier, delayed } = await searchParams;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  // §6.6 the delayed set is computed by the view; intersecting here keeps the
  // definition of "delayed" in one place.
  const delayedIds = delayed
    ? ((await supabase.from('delayed_shipments').select('shipment_id')).data ?? []).map(
        (row) => row.shipment_id,
      )
    : null;

  let query = supabase
    .from('shipments')
    .select('*, couriers(name), orders(order_number)')
    .order('created_at', { ascending: false })
    .limit(250);

  const term = searchTerm(q);
  if (term) query = query.or(`shipment_number.ilike.%${term}%,awb.ilike.%${term}%`);

  const statusFilter = pickFilter(status, SHIPMENT_STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);
  if (courier) query = query.eq('courier_id', courier);
  if (delayedIds) query = query.in('id', delayedIds.length > 0 ? delayedIds : ['00000000-0000-0000-0000-000000000000']);

  const [{ data: shipments }, { data: couriers }, openCount, deliveredCount, delayedCount] =
    await Promise.all([
      query,
      supabase.from('couriers').select('id, name').is('archived_at', null).order('name'),
      supabase
        .from('shipments')
        .select('id', { count: 'exact', head: true })
        .not('status', 'in', '("delivered","closed","cancelled")'),
      supabase.from('shipments').select('id', { count: 'exact', head: true }).eq('status', 'delivered'),
      supabase.from('delayed_shipments').select('shipment_id', { count: 'exact', head: true }),
    ]);

  return (
    <>
      <PageHeader title={t.shipments.title} subtitle={t.shipments.subtitle} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatTile label={t.reports.openShipments} value={openCount.count ?? 0} tone="info" />
        <StatTile label={t.shipments.delivered} value={deliveredCount.count ?? 0} tone="success" />
        <StatTile label={t.shipments.delayed} value={delayedCount.count ?? 0} tone="danger" />
      </div>

      {(delayedCount.count ?? 0) > 0 ? (
        <div className="mb-4">
          <Notice tone="warning" title={t.shipments.delayedTitle}>
            {t.shipments.delayedSubtitle}
          </Notice>
        </div>
      ) : null}

      <Toolbar
        placeholder={`${t.shipments.shipmentNumber} / ${t.shipments.awb}`}
        filters={[
          {
            name: 'status',
            label: t.common.status,
            options: SHIPMENT_STATUSES.map((value) => ({ value, label: t.shipmentStatus[value] })),
          },
          {
            name: 'courier',
            label: t.shipments.courier,
            options: (couriers ?? []).map((c) => ({ value: c.id, label: c.name })),
          },
          { name: 'delayed', label: t.shipments.delayed, options: [{ value: '1', label: t.common.yes }] },
        ]}
      />

      <Card>
        {!shipments || shipments.length === 0 ? (
          <EmptyState title={t.shipments.noShipments} hint={t.shipments.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.shipments.shipmentNumber}</Th>
                <Th>{t.orders.orderNumber}</Th>
                <Th>{t.shipments.courier}</Th>
                <Th>{t.common.status}</Th>
                <Th className="text-end">{t.shipments.attempts}</Th>
                <Th className="text-end">{t.shipments.codAmount}</Th>
                <Th>{t.orders.governorate}</Th>
                <Th>{t.shipments.handedOver}</Th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((shipment) => {
                const courierRow = shipment.couriers as unknown as { name: string } | null;
                const order = shipment.orders as unknown as { order_number: string } | null;

                return (
                  <Tr key={shipment.id}>
                    <Td className="tnum font-medium" dir="ltr">
                      {shipment.shipment_number}
                      {shipment.awb ? (
                        <span className="block text-xs text-ink-subtle">
                          {shipment.tracking_url ? (
                            <a
                              href={shipment.tracking_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-brand hover:underline"
                            >
                              {shipment.awb}
                            </a>
                          ) : (
                            shipment.awb
                          )}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="tnum" dir="ltr">
                      <Link href={`/orders/${shipment.order_id}`} className="text-brand hover:underline">
                        {order?.order_number ?? '—'}
                      </Link>
                    </Td>
                    <Td className="text-ink-muted">{courierRow?.name ?? '—'}</Td>
                    <Td>
                      <EnumBadge section="shipmentStatus" value={shipment.status} />
                      {shipment.failure_reason ? (
                        <span className="block text-xs text-danger">{shipment.failure_reason}</span>
                      ) : null}
                    </Td>
                    <Td className="tnum text-end">
                      {shipment.delivery_attempts >= 3 ? (
                        <Badge tone="danger">{shipment.delivery_attempts}</Badge>
                      ) : (
                        <span className="text-ink-muted">{shipment.delivery_attempts}</span>
                      )}
                    </Td>
                    <Td className="text-end">
                      <Money amount={shipment.cod_amount} currency={shipment.currency} />
                    </Td>
                    <Td className="text-ink-muted">{shipment.governorate ?? '—'}</Td>
                    <Td className="text-ink-muted">
                      <DateTime value={shipment.handed_over_at} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
