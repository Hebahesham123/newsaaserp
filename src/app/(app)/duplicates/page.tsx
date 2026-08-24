import Link from 'next/link';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, EmptyState, Notice, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { DateTime, Money, OrderStatusBadge } from '@/components/status-badge';
import { ActionButton } from '@/components/form/action-button';
import { Toolbar } from '@/components/form/toolbar';
import { searchTerm } from '@/lib/filters';
import { resolveDuplicate } from '../orders/actions';

/**
 * §4.12 the duplicate queue.
 *
 * The flag is written at intake by trigger, so this screen lists what the
 * system already decided rather than re-running detection on every page load.
 * Clearing a flag is an explicit human judgement and is audited like any other
 * order change.
 */
export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requirePermission('orders.duplicates.view');
  const { q } = await searchParams;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('orders')
    .select('*, duplicate_of:orders!orders_duplicate_of_id_fkey(id, order_number)')
    .eq('is_duplicate', true)
    .is('archived_at', null)
    .order('order_date', { ascending: false })
    .limit(200);

  const term = searchTerm(q);
  if (term) {
    query = query.or(`order_number.ilike.%${term}%,customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%`);
  }

  const { data: orders } = await query;
  const canEdit = can(session, 'orders.edit');

  return (
    <>
      <PageHeader title={t.orders.duplicatesTitle} subtitle={t.orders.duplicatesSubtitle} />

      <Toolbar placeholder={`${t.orders.orderNumber} / ${t.orders.phone}`} />

      {orders && orders.length > 0 ? (
        <div className="mb-4">
          <Notice tone="warning">
            {orders.length} {t.common.results} — confirm each one against the original before calling
            the customer twice (§4.12).
          </Notice>
        </div>
      ) : null}

      <Card>
        {!orders || orders.length === 0 ? (
          <EmptyState title={t.common.noResults} hint="No orders are currently flagged as duplicates." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.orders.orderNumber}</Th>
                <Th>{t.orders.customer}</Th>
                <Th>{t.orders.duplicateOf}</Th>
                <Th>{t.common.status}</Th>
                <Th className="text-end">{t.orders.total}</Th>
                <Th>{t.orders.orderDate}</Th>
                {canEdit ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const original = order.duplicate_of as unknown as
                  | { id: string; order_number: string }
                  | null;

                return (
                  <Tr key={order.id}>
                    <Td className="tnum font-medium" dir="ltr">
                      <Link href={`/orders/${order.id}`} className="text-brand hover:underline">
                        {order.order_number}
                      </Link>
                    </Td>
                    <Td>
                      {order.customer_name}
                      <span className="block text-xs text-ink-subtle" dir="ltr">
                        {order.customer_phone}
                      </span>
                    </Td>
                    <Td className="tnum" dir="ltr">
                      {original ? (
                        <Link href={`/orders/${original.id}`} className="text-brand hover:underline">
                          {original.order_number}
                        </Link>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </Td>
                    <Td>
                      <OrderStatusBadge status={order.status} />
                    </Td>
                    <Td className="text-end">
                      <Money amount={order.total} currency={order.currency} />
                    </Td>
                    <Td className="text-ink-muted">
                      <DateTime value={order.order_date} />
                    </Td>
                    {canEdit ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <ActionButton
                            action={resolveDuplicate}
                            fields={{ id: order.id }}
                            label={t.common.no}
                            variant="secondary"
                            size="sm"
                          />
                        </div>
                      </Td>
                    ) : null}
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
