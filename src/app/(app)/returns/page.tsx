import Link from 'next/link';
import { requirePermission } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, StatTile, Table, Td, Th, Tr } from '@/components/ui';
import { DateTime, EnumBadge } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter, searchTerm } from '@/lib/filters';

const RETURN_STATUSES = [
  'requested', 'courier_return', 'returned_to_warehouse', 'quality_inspection',
  'inventory_decision', 'merchant_notified', 'financially_settled', 'closed', 'cancelled',
] as const;

/** §6.7 the returns queue, and §6.8 what inspection decided. */
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; rto?: string }>;
}) {
  await requirePermission('returns.view');
  const { q, status, rto } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('returns')
    .select('*, return_reasons(name_en, name_ar, fault), orders(order_number), return_items(count)')
    .order('requested_at', { ascending: false })
    .limit(250);

  const term = searchTerm(q);
  if (term) query = query.ilike('return_number', `%${term}%`);

  const statusFilter = pickFilter(status, RETURN_STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);
  if (rto) query = query.eq('is_rto', true);

  const [{ data: returns }, openCount, rtoCount, closedCount] = await Promise.all([
    query,
    supabase
      .from('returns')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '("closed","cancelled")'),
    supabase.from('returns').select('id', { count: 'exact', head: true }).eq('is_rto', true),
    supabase.from('returns').select('id', { count: 'exact', head: true }).eq('status', 'closed'),
  ]);

  return (
    <>
      <PageHeader title={t.returns.title} subtitle={t.returns.subtitle} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatTile label={t.common.total} value={openCount.count ?? 0} tone="warning" />
        <StatTile label={t.returns.isRto} value={rtoCount.count ?? 0} tone="danger" />
        <StatTile label={t.returnStatus.closed} value={closedCount.count ?? 0} tone="success" />
      </div>

      <Toolbar
        placeholder={t.returns.returnNumber}
        filters={[
          {
            name: 'status',
            label: t.common.status,
            options: RETURN_STATUSES.map((value) => ({ value, label: t.returnStatus[value] })),
          },
          { name: 'rto', label: t.returns.isRto, options: [{ value: '1', label: t.common.yes }] },
        ]}
      />

      <Card>
        {!returns || returns.length === 0 ? (
          <EmptyState title={t.returns.noReturns} hint={t.returns.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.returns.returnNumber}</Th>
                <Th>{t.orders.orderNumber}</Th>
                <Th>{t.common.status}</Th>
                <Th>{t.returns.reason}</Th>
                <Th>{t.returns.fault}</Th>
                <Th className="text-end">{t.returns.units}</Th>
                <Th>{t.returns.requestedAt}</Th>
                <Th>{t.returns.receivedAt}</Th>
              </tr>
            </thead>
            <tbody>
              {returns.map((row) => {
                const reason = row.return_reasons as unknown as
                  | { name_en: string; name_ar: string; fault: string }
                  | null;
                const order = row.orders as unknown as { order_number: string } | null;
                const itemCount =
                  (row.return_items as unknown as { count: number }[] | null)?.[0]?.count ?? 0;

                return (
                  <Tr key={row.id}>
                    <Td className="tnum font-medium" dir="ltr">
                      {row.return_number}
                      {row.is_rto ? (
                        <Badge tone="danger" className="ms-2 text-[10px]">
                          {t.returns.isRto}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="tnum" dir="ltr">
                      <Link href={`/orders/${row.order_id}`} className="text-brand hover:underline">
                        {order?.order_number ?? '—'}
                      </Link>
                    </Td>
                    <Td>
                      <EnumBadge section="returnStatus" value={row.status} />
                    </Td>
                    <Td className="text-ink-muted">
                      {reason ? (locale === 'ar' ? reason.name_ar : reason.name_en) : '—'}
                    </Td>
                    <Td className="text-ink-muted">
                      {/* §6.9 who bears the cost — the split the returns report needs. */}
                      {reason?.fault ? <Badge tone="neutral">{reason.fault}</Badge> : '—'}
                    </Td>
                    <Td className="tnum text-end text-ink-muted">{itemCount}</Td>
                    <Td className="text-ink-muted">
                      <DateTime value={row.requested_at} />
                    </Td>
                    <Td className="text-ink-muted">
                      <DateTime value={row.received_at} />
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
