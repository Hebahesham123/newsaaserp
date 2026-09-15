import Link from 'next/link';
import type { Route } from 'next';
import { AlertTriangle, Package, Truck, Store } from 'lucide-react';
import type { Dictionary } from '@/i18n/dictionaries/en';
import type { CompanyDashboard } from '@/lib/dashboard';
import {
  Badge,
  Card,
  CardBody,
  CardHeaderRow,
  EmptyState,
  Meter,
  Notice,
  StatTile,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';

/**
 * §Dashboard — the client view.
 *
 * Composed from whatever the caller resolved: a panel is present only when its
 * module is active and the viewer may read the data, so this component renders
 * what it is given rather than deciding anything itself. That keeps the two
 * gates — module and permission — in one place in `lib/dashboard.ts`.
 */
export function CompanyDashboardView({
  data,
  t,
  currency,
}: {
  data: CompanyDashboard;
  t: Dictionary;
  currency: string;
}) {
  const { fulfillment, ecommerce, attention, funnel } = data;

  // The funnel is only meaningful against its own first stage: a client with no
  // orders yet would otherwise see six full-width bars at 0%.
  const funnelTop = funnel[0]?.count ?? 0;

  return (
    <>
      {/* §Attention Required — what a human must act on, before any metric. */}
      {attention.length > 0 ? (
        <Card className="mb-6">
          <CardHeaderRow title={t.dashboard.attentionTitle} hint={t.dashboard.attentionHint} />
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {attention.map((item) => (
                <Link
                  key={item.key}
                  href={item.href as Route}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm transition-colors hover:bg-surface-muted"
                >
                  <AlertTriangle
                    className={item.tone === 'danger' ? 'size-4 text-danger' : 'size-4 text-warning'}
                    aria-hidden
                  />
                  <span className="text-ink">{t.dashboard.attention[item.key]}</span>
                  <Badge tone={item.tone}>{item.count}</Badge>
                </Link>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {/* §Fulfillment Module */}
      {fulfillment ? (
        <section className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <Truck className="size-4 text-brand" aria-hidden />
            {t.dashboard.fulfillmentModule}
          </h2>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label={t.dashboard.ordersReceived} value={fulfillment.received} tone="brand" />
            <StatTile label={t.dashboard.pendingFulfillment} value={fulfillment.pendingFulfillment} tone="warning" />
            <StatTile label={t.dashboard.picking} value={fulfillment.picking} tone="info" />
            <StatTile label={t.dashboard.readyToShip} value={fulfillment.readyToShip} tone="info" />
            <StatTile label={t.dashboard.shipped} value={fulfillment.shipped} tone="neutral" />

            <StatTile label={t.dashboard.delivered} value={fulfillment.delivered} tone="success" />
            <StatTile label={t.dashboard.cancelled} value={fulfillment.cancelled} tone="danger" />
            <StatTile label={t.dashboard.returned} value={fulfillment.returned} tone="danger" />
            <StatTile
              label={t.dashboard.delayedOrders}
              value={fulfillment.delayed}
              tone={fulfillment.delayed > 0 ? 'danger' : 'neutral'}
            />
            <StatTile
              label={t.dashboard.avgProcessing}
              value={fulfillment.avgProcessingHours != null ? `${fulfillment.avgProcessingHours}h` : '—'}
              tone="info"
            />
          </div>

          {fulfillment.fulfillmentRate != null ? (
            <Card className="mt-3">
              <CardBody>
                <Meter
                  value={fulfillment.fulfillmentRate}
                  label={`${t.dashboard.fulfillmentRate} — ${fulfillment.fulfillmentRate}%`}
                  tone={
                    fulfillment.fulfillmentRate >= 90
                      ? 'success'
                      : fulfillment.fulfillmentRate >= 70
                        ? 'warning'
                        : 'danger'
                  }
                />
              </CardBody>
            </Card>
          ) : null}
        </section>
      ) : null}

      {/* §E-Commerce Management Module */}
      {ecommerce ? (
        <section className="mb-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink">
            <Store className="size-4 text-brand" aria-hidden />
            {t.dashboard.ecommerceModule}
          </h2>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label={t.dashboard.ordersToday} value={ecommerce.ordersToday} tone="brand" />
            <StatTile
              label={t.dashboard.salesToday}
              value={Math.round(ecommerce.salesToday)}
              hint={currency}
              tone="success"
            />
            <StatTile
              label={t.dashboard.salesMtd}
              value={Math.round(ecommerce.salesMtd)}
              hint={currency}
              tone="success"
            />
            <StatTile
              label={t.dashboard.averageOrderValue}
              value={ecommerce.averageOrderValue != null ? Math.round(ecommerce.averageOrderValue) : '—'}
              hint={currency}
              tone="info"
            />
            <StatTile label={t.dashboard.pendingOrders} value={ecommerce.pending} tone="warning" />

            <StatTile label={t.dashboard.cancelled} value={ecommerce.cancelled} tone="danger" />
            <StatTile label={t.dashboard.returned} value={ecommerce.returned} tone="danger" />
            <StatTile
              label={t.dashboard.lowStock}
              value={ecommerce.lowStock}
              tone={ecommerce.lowStock > 0 ? 'warning' : 'neutral'}
            />
            <StatTile
              label={t.dashboard.outOfStock}
              value={ecommerce.outOfStock}
              tone={ecommerce.outOfStock > 0 ? 'danger' : 'neutral'}
            />
            <StatTile
              label={t.dashboard.connectedStores}
              value={`${ecommerce.storesConnected}`}
              hint={
                ecommerce.storesWithSyncError > 0
                  ? `${ecommerce.storesWithSyncError} ${t.dashboard.syncErrorsShort}`
                  : undefined
              }
              tone={ecommerce.storesWithSyncError > 0 ? 'danger' : 'success'}
            />
          </div>

          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeaderRow title={t.dashboard.ordersBySource} hint={t.dashboard.todayHint} />
              {ecommerce.byStore.length === 0 ? (
                <EmptyState title={t.common.noResults} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t.nav.stores}</Th>
                      <Th className="text-end">{t.orders.title}</Th>
                      <Th className="text-end">{t.dashboard.salesToday}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ecommerce.byStore.map((row) => (
                      <Tr key={row.store}>
                        <Td>{row.store}</Td>
                        <Td className="tnum text-end">{row.orders}</Td>
                        <Td className="tnum text-end">{Math.round(row.sales)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>

            <Card>
              <CardHeaderRow title={t.dashboard.topProducts} />
              {ecommerce.topProducts.length === 0 ? (
                <EmptyState title={t.common.noResults} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t.products.sku}</Th>
                      <Th className="text-end">{t.dashboard.unitsSold}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ecommerce.topProducts.map((row) => (
                      <Tr key={row.sku}>
                        <Td className="tnum" dir="ltr">
                          <Package className="me-2 inline size-3.5 text-ink-subtle" aria-hidden />
                          {row.sku}
                        </Td>
                        <Td className="tnum text-end">{row.units}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>
        </section>
      ) : null}

      {/* §Order Funnel */}
      {funnel.length > 0 && funnelTop > 0 ? (
        <Card>
          <CardHeaderRow title={t.dashboard.funnelTitle} hint={t.dashboard.funnelHint} />
          <CardBody>
            <div className="space-y-3">
              {funnel.map((stage) => (
                <Meter
                  key={stage.key}
                  value={stage.count}
                  max={funnelTop}
                  label={`${t.dashboard.funnel[stage.key]} — ${stage.count}`}
                  tone={stage.key === 'returned' ? 'danger' : 'brand'}
                />
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {!fulfillment && !ecommerce ? (
        <Notice tone="info" title={t.dashboard.noModulesTitle}>
          {t.dashboard.noModulesBody}
        </Notice>
      ) : null}
    </>
  );
}
