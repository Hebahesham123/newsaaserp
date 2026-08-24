import Link from 'next/link';
import { requirePermission } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, EmptyState, Notice, PageHeader, StatTile, Table, Td, Th, Tr } from '@/components/ui';
import { DateOnly, Money, OrderStatusBadge } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { searchTerm } from '@/lib/filters';

/**
 * §7.9 order-level P&L.
 *
 * Reads `order_profitability`, which is a view over `order_costs` — so the
 * numbers here follow their inputs automatically (§7.12 rule 6) rather than
 * being recomputed by this page.
 */
export default async function ProfitabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; merchant?: string; loss?: string }>;
}) {
  await requirePermission('finance.profit.view');
  const { q, merchant, loss } = await searchParams;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('order_profitability')
    .select('*')
    .order('order_date', { ascending: false })
    .limit(250);

  const term = searchTerm(q);
  if (term) query = query.ilike('order_number', `%${term}%`);
  if (merchant) query = query.eq('merchant_id', merchant);
  // The orders that are actively costing money — the reason this screen exists.
  if (loss) query = query.lt('gross_profit', 0);

  const [{ data: rows }, { data: merchants }] = await Promise.all([
    query,
    supabase.from('merchants').select('id, name').is('archived_at', null).order('name'),
  ]);

  const totals = (rows ?? []).reduce(
    (acc, row) => ({
      revenue: acc.revenue + Number(row.revenue),
      cost: acc.cost + Number(row.total_cost),
      profit: acc.profit + Number(row.gross_profit),
    }),
    { revenue: 0, cost: 0, profit: 0 },
  );

  const margin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : null;

  return (
    <>
      <PageHeader title={t.profitability.title} subtitle={t.profitability.subtitle} />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatTile label={t.profitability.revenue} value={Math.round(totals.revenue)} tone="brand" />
        <StatTile label={t.profitability.totalCost} value={Math.round(totals.cost)} tone="warning" />
        <StatTile
          label={t.profitability.grossProfit}
          value={Math.round(totals.profit)}
          tone={totals.profit < 0 ? 'danger' : 'success'}
        />
        <StatTile
          label={t.profitability.margin}
          value={margin != null ? `${margin.toFixed(1)}%` : '—'}
          tone={margin != null && margin < 0 ? 'danger' : 'info'}
        />
      </div>

      <div className="mb-4">
        <Notice tone="info">
          Costs are only as complete as the cost lines behind them. An order with no recorded costs
          shows as pure profit — run the cost rebuild on an order to populate its derived lines (§7.3).
        </Notice>
      </div>

      <Toolbar
        placeholder={t.orders.orderNumber}
        filters={[
          {
            name: 'merchant',
            label: t.stores.merchant,
            options: (merchants ?? []).map((m) => ({ value: m.id, label: m.name })),
          },
          { name: 'loss', label: t.profitability.grossProfit, options: [{ value: '1', label: '< 0' }] },
        ]}
      />

      <Card>
        {!rows || rows.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.profitability.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.orders.orderNumber}</Th>
                <Th>{t.orders.orderDate}</Th>
                <Th>{t.common.status}</Th>
                <Th className="text-end">{t.profitability.revenue}</Th>
                <Th className="text-end">{t.profitability.productCost}</Th>
                <Th className="text-end">{t.profitability.shippingCost}</Th>
                <Th className="text-end">{t.profitability.marketingCost}</Th>
                <Th className="text-end">{t.profitability.totalCost}</Th>
                <Th className="text-end">{t.profitability.grossProfit}</Th>
                <Th className="text-end">{t.profitability.margin}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const profit = Number(row.gross_profit);
                return (
                  <Tr key={row.order_id}>
                    <Td className="tnum font-medium" dir="ltr">
                      <Link href={`/orders/${row.order_id}`} className="text-brand hover:underline">
                        {row.order_number}
                      </Link>
                    </Td>
                    <Td className="text-ink-muted">
                      <DateOnly value={row.order_date} />
                    </Td>
                    <Td>
                      <OrderStatusBadge status={row.status} />
                    </Td>
                    <Td className="text-end">
                      <Money amount={row.revenue} currency={row.currency} />
                    </Td>
                    <Td className="text-end text-ink-muted">
                      <Money amount={row.product_cost} currency={row.currency} />
                    </Td>
                    <Td className="text-end text-ink-muted">
                      <Money amount={row.shipping_cost} currency={row.currency} />
                    </Td>
                    <Td className="text-end text-ink-muted">
                      <Money amount={row.marketing_cost} currency={row.currency} />
                    </Td>
                    <Td className="text-end text-ink-muted">
                      <Money amount={row.total_cost} currency={row.currency} />
                    </Td>
                    <Td className="text-end font-medium">
                      <span className={profit < 0 ? 'text-danger' : 'text-success'}>
                        <Money amount={profit} currency={row.currency} />
                      </span>
                    </Td>
                    <Td className="tnum text-end">
                      {row.margin_percentage != null ? (
                        <span className={Number(row.margin_percentage) < 0 ? 'text-danger' : 'text-ink-muted'}>
                          {row.margin_percentage}%
                        </span>
                      ) : (
                        '—'
                      )}
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
