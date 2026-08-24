import { requirePermission } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, ButtonLink, Card, EmptyState, PageHeader, StatTile, Table, Td, Th, Tr } from '@/components/ui';
import { DateTime } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { searchTerm } from '@/lib/filters';

/**
 * §5.8 the eight stock buckets per SKU per warehouse.
 *
 * Reads `stock_on_hand`, which joins the buckets to SKU and product names and
 * computes the reorder flag — so this screen and the §5.24 KPI report cannot
 * disagree about what "on hand" means.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; warehouse?: string; reorder?: string }>;
}) {
  await requirePermission('inventory.view');
  const { q, warehouse, reorder } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('stock_on_hand')
    .select('*')
    .order('available', { ascending: true })
    .limit(300);

  const term = searchTerm(q);
  if (term) query = query.or(`sku.ilike.%${term}%,name_en.ilike.%${term}%,name_ar.ilike.%${term}%`);
  if (warehouse) query = query.eq('warehouse_id', warehouse);
  if (reorder) query = query.eq('needs_reorder', true);

  const [{ data: rows }, { data: warehouses }] = await Promise.all([
    query,
    supabase.from('warehouses').select('id, name').is('archived_at', null).order('name'),
  ]);

  const totals = (rows ?? []).reduce(
    (acc, row) => ({
      available: acc.available + Number(row.available),
      reserved: acc.reserved + Number(row.reserved),
      damaged: acc.damaged + Number(row.damaged),
      reorder: acc.reorder + (row.needs_reorder ? 1 : 0),
    }),
    { available: 0, reserved: 0, damaged: 0, reorder: 0 },
  );

  return (
    <>
      <PageHeader
        title={t.inventory.title}
        subtitle={t.inventory.subtitle}
        actions={
          <ButtonLink href="/inventory/ledger" variant="secondary">
            {t.inventory.ledgerTitle}
          </ButtonLink>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatTile label={t.inventory.available} value={totals.available} tone="success" />
        <StatTile label={t.inventory.reserved} value={totals.reserved} tone="info" />
        <StatTile label={t.inventory.damaged} value={totals.damaged} tone="danger" />
        <StatTile label={t.inventory.needsReorder} value={totals.reorder} tone="warning" />
      </div>

      <Toolbar
        placeholder={`${t.inventory.sku} / ${t.common.name}`}
        filters={[
          {
            name: 'warehouse',
            label: t.inventory.warehouse,
            options: (warehouses ?? []).map((w) => ({ value: w.id, label: w.name })),
          },
          { name: 'reorder', label: t.inventory.needsReorder, options: [{ value: '1', label: t.common.yes }] },
        ]}
      />

      <Card>
        {!rows || rows.length === 0 ? (
          <EmptyState title={t.inventory.noStock} hint={t.inventory.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.inventory.sku}</Th>
                <Th>{t.common.name}</Th>
                <Th className="text-end">{t.inventory.available}</Th>
                <Th className="text-end">{t.inventory.reserved}</Th>
                <Th className="text-end">{t.inventory.picking}</Th>
                <Th className="text-end">{t.inventory.packed}</Th>
                <Th className="text-end">{t.inventory.inTransit}</Th>
                <Th className="text-end">{t.inventory.damaged}</Th>
                <Th className="text-end">{t.inventory.onHand}</Th>
                <Th>{t.inventory.lastMovement}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={`${row.warehouse_id}-${row.variant_id}`}>
                  <Td className="tnum font-medium" dir="ltr">
                    {row.sku}
                    {row.needs_reorder ? (
                      <Badge tone="warning" className="ms-2 text-[10px]">
                        {t.inventory.needsReorder}
                      </Badge>
                    ) : null}
                  </Td>
                  <Td className="text-ink-muted">
                    {(locale === 'ar' ? row.name_ar : row.name_en) ?? '—'}
                  </Td>
                  <Td className="tnum text-end font-medium">{row.available}</Td>
                  <Td className="tnum text-end text-ink-muted">{row.reserved}</Td>
                  <Td className="tnum text-end text-ink-muted">{row.picking}</Td>
                  <Td className="tnum text-end text-ink-muted">{row.packed}</Td>
                  <Td className="tnum text-end text-ink-muted">{row.in_transit}</Td>
                  <Td className="tnum text-end">
                    {Number(row.damaged) > 0 ? (
                      <span className="text-danger">{row.damaged}</span>
                    ) : (
                      <span className="text-ink-muted">0</span>
                    )}
                  </Td>
                  <Td className="tnum text-end font-medium">{row.on_hand}</Td>
                  <Td className="text-ink-muted">
                    <DateTime value={row.last_movement_at} />
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
