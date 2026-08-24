import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  Badge,
  Card,
  CardBody,
  CardHeaderRow,
  EmptyState,
  Notice,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { EnumBadge } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter } from '@/lib/filters';

const CATEGORIES = [
  'orders', 'confirmation', 'warehouse', 'inventory', 'shipping', 'returns',
  'collections', 'financial', 'profitability', 'products', 'customers',
  'merchants', 'affiliates', 'employees', 'executive',
] as const;

/**
 * §9.3 the report catalogue and §9.22 the executive board.
 *
 * The catalogue lists what this user may run: `report_definitions` is filtered
 * by its own `requires_permission` in RLS, so a report whose data the user
 * cannot see is not even listed — that is §9.19 without a second permission
 * system.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const session = await requirePermission('reports.view');
  const { category } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('report_definitions')
    .select('*')
    .eq('is_active', true)
    .order('category')
    .order('sort_order');

  const categoryFilter = pickFilter(category, CATEGORIES);
  if (categoryFilter) query = query.eq('category', categoryFilter);

  const canExecutive = can(session, 'reports.executive');

  const [{ data: reports }, kpiResult] = await Promise.all([
    query,
    canExecutive
      ? supabase.from('rpt_executive_kpis').select('*').maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const kpis = kpiResult.data;

  return (
    <>
      <PageHeader title={t.reports.title} subtitle={t.reports.subtitle} />

      {/* ---------------------------------------------------------------- */}
      {/* §9.22 Executive board                                            */}
      {/* ---------------------------------------------------------------- */}
      {kpis ? (
        <Card className="mb-4">
          <CardHeaderRow title={t.reports.executiveTitle} hint={t.reports.executiveSubtitle} />
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatTile label={t.reports.totalOrders} value={kpis.total_orders} tone="brand" />
              <StatTile label={t.reports.orders30d} value={kpis.orders_30d} tone="info" />
              <StatTile label={t.reports.openConfirmations} value={kpis.open_confirmations} tone="warning" />
              <StatTile label={t.reports.grossRevenue} value={Math.round(kpis.gross_revenue)} tone="success" />
              <StatTile
                label={t.reports.avgOrderValue}
                value={Math.round(kpis.average_order_value)}
                tone="neutral"
              />

              <StatTile label={t.reports.openShipments} value={kpis.open_shipments} tone="info" />
              <StatTile label={t.reports.deliveredShipments} value={kpis.delivered_shipments} tone="success" />
              <StatTile label={t.reports.totalReturns} value={kpis.total_returns} tone="danger" />
              <StatTile label={t.reports.outstandingCod} value={Math.round(kpis.outstanding_cod)} tone="warning" />
              <StatTile label={t.reports.collectedCod} value={Math.round(kpis.collected_cod)} tone="success" />

              <StatTile
                label={t.reports.grossProfit}
                value={Math.round(kpis.gross_profit)}
                tone={kpis.gross_profit < 0 ? 'danger' : 'success'}
              />
              <StatTile
                label={t.reports.operatingExpenses}
                value={Math.round(kpis.operating_expenses)}
                tone="warning"
              />
              <StatTile label={t.reports.marketingSpend} value={Math.round(kpis.marketing_spend)} tone="info" />
              <StatTile label={t.reports.activeProducts} value={kpis.active_products} tone="neutral" />
              <StatTile
                label={t.reports.outOfStock}
                value={kpis.out_of_stock_skus}
                tone={kpis.out_of_stock_skus > 0 ? 'danger' : 'neutral'}
              />
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div className="mb-4">
        <Notice tone="info">{t.reports.permissionNote}</Notice>
      </div>

      <Toolbar
        filters={[
          {
            name: 'category',
            label: t.reports.category,
            options: CATEGORIES.map((value) => ({ value, label: t.reportCategory[value] })),
          },
        ]}
      />

      <Card>
        {!reports || reports.length === 0 ? (
          <EmptyState title={t.reports.noReports} hint={t.reports.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.name}</Th>
                <Th>{t.reports.category}</Th>
                <Th>{t.reports.source}</Th>
                <Th>{t.common.description}</Th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <Tr key={report.id}>
                  <Td className="font-medium">
                    {locale === 'ar' ? report.name_ar : report.name_en}
                    {report.is_system ? (
                      <Badge tone="neutral" className="ms-2 text-[10px]">
                        {t.reports.systemTemplate}
                      </Badge>
                    ) : null}
                  </Td>
                  <Td>
                    <EnumBadge section="reportCategory" value={report.category} tone="brand" />
                  </Td>
                  <Td className="tnum text-xs text-ink-muted" dir="ltr">
                    {report.source_view}
                  </Td>
                  <Td className="text-xs text-ink-muted">
                    {report.description ??
                      (report.requires_permission
                        ? `Requires ${report.requires_permission}`
                        : '—')}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
