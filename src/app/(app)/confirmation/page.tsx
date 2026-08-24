import Link from 'next/link';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, StatTile, Table, Tabs, Td, Th, Tr } from '@/components/ui';
import { DateTime, Money, OrderStatusBadge, RiskBadge } from '@/components/status-badge';
import { ActionButton } from '@/components/form/action-button';
import { claimOrder } from '../orders/actions';

/**
 * §4.7 Confirmation Center.
 *
 * Reads the `confirmation_queue` view rather than filtering `orders` again, so
 * this screen and the §4.16 SLA report always agree on what "still open" means.
 * Oldest first: the order that has been waiting longest is the one at risk.
 */
export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requirePermission('orders.view');
  const { tab } = await searchParams;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const active = tab === 'all' || tab === 'callbacks' ? tab : 'mine';
  const canAssign = can(session, 'orders.assign');

  let query = supabase
    .from('confirmation_queue')
    .select('*')
    .order('order_date', { ascending: true })
    .limit(200);

  if (active === 'mine') {
    query = query.eq('assigned_to', session.profile.id);
  } else if (active === 'callbacks') {
    query = query.not('next_callback_at', 'is', null).lte('next_callback_at', new Date().toISOString());
  }

  // Counts drive the tab badges and the three tiles; RLS already restricts each
  // of them to what this user may see.
  const [{ data: rows }, mineCount, openCount, callbackCount] = await Promise.all([
    query,
    supabase
      .from('confirmation_queue')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', session.profile.id),
    supabase.from('confirmation_queue').select('id', { count: 'exact', head: true }),
    supabase
      .from('confirmation_queue')
      .select('id', { count: 'exact', head: true })
      .not('next_callback_at', 'is', null)
      .lte('next_callback_at', new Date().toISOString()),
  ]);

  return (
    <>
      <PageHeader title={t.orders.confirmationTitle} subtitle={t.orders.confirmationSubtitle} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatTile label={t.orders.myQueue} value={mineCount.count ?? 0} tone="brand" />
        <StatTile label={t.orders.allQueue} value={openCount.count ?? 0} tone="info" />
        <StatTile label={t.orders.callbacksDue} value={callbackCount.count ?? 0} tone="warning" />
      </div>

      <Tabs
        active={`/confirmation?tab=${active}`}
        items={[
          { href: '/confirmation?tab=mine', label: t.orders.myQueue, count: mineCount.count ?? 0 },
          { href: '/confirmation?tab=all', label: t.orders.allQueue, count: openCount.count ?? 0 },
          { href: '/confirmation?tab=callbacks', label: t.orders.callbacksDue, count: callbackCount.count ?? 0 },
        ]}
      />

      <Card>
        {!rows || rows.length === 0 ? (
          <EmptyState
            title={t.orders.noOrders}
            hint={
              active === 'mine'
                ? 'Nothing is assigned to you right now.'
                : t.orders.confirmationSubtitle
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.orders.orderNumber}</Th>
                <Th>{t.orders.customer}</Th>
                <Th>{t.common.status}</Th>
                <Th className="text-end">{t.orders.total}</Th>
                <Th className="text-end">{t.orders.callAttempts}</Th>
                <Th className="text-end">{t.orders.ageHours}</Th>
                <Th className="text-end">{t.orders.riskScore}</Th>
                <Th>{t.orders.callbackAt}</Th>
                {canAssign ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td className="tnum font-medium" dir="ltr">
                    <Link href={`/orders/${row.id}`} className="text-brand hover:underline">
                      {row.order_number}
                    </Link>
                    {row.is_duplicate ? (
                      <Badge tone="warning" className="ms-2 text-[10px]">
                        {t.orders.duplicate}
                      </Badge>
                    ) : null}
                  </Td>
                  <Td>
                    {row.customer_name}
                    <span className="block text-xs text-ink-subtle" dir="ltr">
                      {row.customer_phone}
                    </span>
                  </Td>
                  <Td>
                    <OrderStatusBadge status={row.status} />
                  </Td>
                  <Td className="text-end">
                    <Money amount={row.total} currency={row.currency} />
                  </Td>
                  <Td className="tnum text-end text-ink-muted">{row.call_attempts}</Td>
                  <Td className="tnum text-end">
                    {/* An order older than a day in the queue is the SLA problem. */}
                    <span className={row.age_hours > 24 ? 'font-medium text-danger' : 'text-ink-muted'}>
                      {Math.round(row.age_hours)}
                    </span>
                  </Td>
                  <Td className="text-end">
                    <RiskBadge score={row.risk_score} />
                  </Td>
                  <Td className="text-ink-muted">
                    <DateTime value={row.next_callback_at} />
                  </Td>
                  {canAssign ? (
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        {row.assigned_to ? null : (
                          <ActionButton
                            action={claimOrder}
                            fields={{ id: row.id }}
                            label={t.orders.assignToMe}
                            variant="secondary"
                            size="sm"
                          />
                        )}
                      </div>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
