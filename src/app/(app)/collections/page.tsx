import Link from 'next/link';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, CardHeaderRow, EmptyState, PageHeader, StatTile, Table, Td, Th, Tr } from '@/components/ui';
import { DateOnly, EnumBadge, Money } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter } from '@/lib/filters';

const COLLECTION_STATUSES = [
  'pending', 'collected', 'in_transfer', 'settled', 'short', 'over', 'missing', 'waived',
] as const;

/**
 * §6.10 / §6.11 the COD money view.
 *
 * `variance` is a generated column, so the difference between expected and
 * collected is arithmetic on the row rather than something this page computes
 * and could get wrong.
 */
export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; courier?: string; overdue?: string }>;
}) {
  const session = await requirePermission('collections.view');
  const { status, courier, overdue } = await searchParams;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('cod_collections')
    .select('*, couriers(name), orders(order_number)')
    .order('due_at', { ascending: true, nullsFirst: false })
    .limit(250);

  const statusFilter = pickFilter(status, COLLECTION_STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);
  if (courier) query = query.eq('courier_id', courier);
  if (overdue) {
    query = query.is('collected_at', null).lt('due_at', new Date().toISOString());
  }

  const [{ data: rows }, { data: couriers }, { data: statements }] = await Promise.all([
    query,
    supabase.from('couriers').select('id, name').is('archived_at', null).order('name'),
    supabase
      .from('courier_statements')
      .select('*, couriers(name)')
      .order('period_start', { ascending: false })
      .limit(20),
  ]);

  const totals = (rows ?? []).reduce(
    (acc, row) => ({
      expected: acc.expected + Number(row.expected_amount),
      collected: acc.collected + Number(row.collected_amount ?? 0),
      variance: acc.variance + Number(row.variance),
    }),
    { expected: 0, collected: 0, variance: 0 },
  );

  const canReconcile = can(session, 'collections.reconcile');

  return (
    <>
      <PageHeader title={t.collections.title} subtitle={t.collections.subtitle} />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatTile label={t.collections.expected} value={Math.round(totals.expected)} tone="info" />
        <StatTile label={t.collections.collected} value={Math.round(totals.collected)} tone="success" />
        <StatTile
          label={t.collections.variance}
          value={Math.round(totals.variance)}
          tone={totals.variance < 0 ? 'danger' : 'neutral'}
        />
      </div>

      <Toolbar
        filters={[
          {
            name: 'status',
            label: t.common.status,
            options: COLLECTION_STATUSES.map((value) => ({ value, label: t.collectionStatus[value] })),
          },
          {
            name: 'courier',
            label: t.shipments.courier,
            options: (couriers ?? []).map((c) => ({ value: c.id, label: c.name })),
          },
          { name: 'overdue', label: t.collections.overdue, options: [{ value: '1', label: t.common.yes }] },
        ]}
      />

      <Card>
        {!rows || rows.length === 0 ? (
          <EmptyState title={t.collections.noCollections} hint={t.collections.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.orders.orderNumber}</Th>
                <Th>{t.shipments.courier}</Th>
                <Th>{t.common.status}</Th>
                <Th className="text-end">{t.collections.expected}</Th>
                <Th className="text-end">{t.collections.collected}</Th>
                <Th className="text-end">{t.collections.courierFee}</Th>
                <Th className="text-end">{t.collections.net}</Th>
                <Th className="text-end">{t.collections.variance}</Th>
                <Th>{t.collections.dueAt}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const courierRow = row.couriers as unknown as { name: string } | null;
                const order = row.orders as unknown as { order_number: string } | null;
                const variance = Number(row.variance);
                const isOverdue =
                  row.collected_at == null && row.due_at != null && row.due_at < new Date().toISOString();

                return (
                  <Tr key={row.id}>
                    <Td className="tnum font-medium" dir="ltr">
                      <Link href={`/orders/${row.order_id}`} className="text-brand hover:underline">
                        {order?.order_number ?? '—'}
                      </Link>
                    </Td>
                    <Td className="text-ink-muted">{courierRow?.name ?? '—'}</Td>
                    <Td>
                      <EnumBadge section="collectionStatus" value={row.status} />
                    </Td>
                    <Td className="text-end">
                      <Money amount={row.expected_amount} currency={row.currency} />
                    </Td>
                    <Td className="text-end">
                      <Money amount={row.collected_amount} currency={row.currency} />
                    </Td>
                    <Td className="text-end text-ink-muted">
                      <Money amount={row.courier_fee} currency={row.currency} />
                    </Td>
                    <Td className="text-end font-medium">
                      <Money amount={row.net_amount} currency={row.currency} />
                    </Td>
                    <Td className="text-end">
                      {variance === 0 ? (
                        <span className="text-ink-subtle">—</span>
                      ) : (
                        <span className={variance < 0 ? 'tnum text-danger' : 'tnum text-success'}>
                          {variance > 0 ? `+${variance}` : variance}
                        </span>
                      )}
                    </Td>
                    <Td className="text-ink-muted">
                      <DateOnly value={row.due_at} />
                      {isOverdue ? (
                        <Badge tone="danger" className="ms-2 text-[10px]">
                          {t.collections.overdue}
                        </Badge>
                      ) : null}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* §6.11 courier statements and their reconciliation state. */}
      {canReconcile ? (
        <Card className="mt-4">
          <CardHeaderRow title={t.collections.statements} hint={t.collections.statementsSubtitle} />
          {!statements || statements.length === 0 ? (
            <EmptyState title={t.common.noResults} hint={t.collections.statementsSubtitle} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t.collections.statementNumber}</Th>
                  <Th>{t.shipments.courier}</Th>
                  <Th>{t.collections.period}</Th>
                  <Th>{t.common.status}</Th>
                  <Th className="text-end">{t.collections.declaredTotal}</Th>
                  <Th className="text-end">{t.collections.matchedTotal}</Th>
                  <Th className="text-end">{t.collections.varianceTotal}</Th>
                </tr>
              </thead>
              <tbody>
                {statements.map((statement) => {
                  const courierRow = statement.couriers as unknown as { name: string } | null;
                  const diff = Number(statement.variance_total);

                  return (
                    <Tr key={statement.id}>
                      <Td className="tnum font-medium" dir="ltr">{statement.statement_number}</Td>
                      <Td className="text-ink-muted">{courierRow?.name ?? '—'}</Td>
                      <Td className="text-ink-muted">
                        <DateOnly value={statement.period_start} /> – <DateOnly value={statement.period_end} />
                      </Td>
                      <Td>
                        <EnumBadge section="statementStatus" value={statement.status} />
                      </Td>
                      <Td className="text-end">
                        <Money amount={statement.declared_total} currency={statement.currency} />
                      </Td>
                      <Td className="text-end">
                        <Money amount={statement.matched_total} currency={statement.currency} />
                      </Td>
                      <Td className="text-end">
                        <span className={diff !== 0 ? 'tnum text-danger' : 'tnum text-ink-subtle'}>{diff}</span>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      ) : null}
    </>
  );
}
