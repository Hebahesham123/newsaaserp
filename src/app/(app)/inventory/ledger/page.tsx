import { requirePermission } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Breadcrumb, Card, EmptyState, Notice, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { DateTime, EnumBadge } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter, searchTerm } from '@/lib/filters';

const TXN_TYPES = [
  'receiving', 'put_away', 'reservation', 'picking', 'packing', 'shipment',
  'return', 'damage', 'adjustment', 'warehouse_transfer', 'inventory_count',
] as const;

/**
 * §5.10 the inventory ledger.
 *
 * Read-only by construction: the table refuses UPDATE and DELETE at the trigger
 * level, and no client role is granted either verb. Movements are posted
 * through `post_inventory_movement`, which writes balanced pairs.
 */
export default async function InventoryLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; warehouse?: string }>;
}) {
  await requirePermission('inventory.ledger.view');
  const { q, type, warehouse } = await searchParams;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('inventory_ledger')
    .select('*, product_variants(sku), warehouses(name), warehouse_locations(code)')
    .order('created_at', { ascending: false })
    .limit(250);

  const term = searchTerm(q);
  if (term) query = query.ilike('txn_number', `%${term}%`);

  const typeFilter = pickFilter(type, TXN_TYPES);
  if (typeFilter) query = query.eq('txn_type', typeFilter);
  if (warehouse) query = query.eq('warehouse_id', warehouse);

  const [{ data: rows }, { data: warehouses }] = await Promise.all([
    query,
    supabase.from('warehouses').select('id, name').is('archived_at', null).order('name'),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb items={[{ label: t.inventory.title, href: '/inventory' }, { label: t.inventory.ledgerTitle }]} />
        }
        title={t.inventory.ledgerTitle}
        subtitle={t.inventory.ledgerSubtitle}
      />

      <div className="mb-4">
        <Notice tone="info">{t.inventory.ledgerImmutable}</Notice>
      </div>

      <Toolbar
        placeholder={t.inventory.txnNumber}
        filters={[
          {
            name: 'type',
            label: t.inventory.txnType,
            options: TXN_TYPES.map((value) => ({ value, label: t.inventoryTxnType[value] })),
          },
          {
            name: 'warehouse',
            label: t.inventory.warehouse,
            options: (warehouses ?? []).map((w) => ({ value: w.id, label: w.name })),
          },
        ]}
      />

      <Card>
        {!rows || rows.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.inventory.ledgerSubtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.inventory.txnNumber}</Th>
                <Th>{t.audit.when}</Th>
                <Th>{t.inventory.txnType}</Th>
                <Th>{t.inventory.sku}</Th>
                <Th>{t.inventory.bucket}</Th>
                <Th className="text-end">{t.inventory.quantity}</Th>
                <Th>{t.inventory.warehouse}</Th>
                <Th>{t.inventory.reason}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const variant = row.product_variants as unknown as { sku: string } | null;
                const wh = row.warehouses as unknown as { name: string } | null;
                const quantity = Number(row.quantity);

                return (
                  <Tr key={row.id}>
                    <Td className="tnum font-medium" dir="ltr">{row.txn_number}</Td>
                    <Td className="text-ink-muted">
                      <DateTime value={row.created_at} />
                    </Td>
                    <Td>
                      <EnumBadge section="inventoryTxnType" value={row.txn_type} tone="neutral" />
                    </Td>
                    <Td className="tnum" dir="ltr">{variant?.sku ?? '—'}</Td>
                    <Td className="text-ink-muted">{row.bucket}</Td>
                    {/* The sign is the direction: out of a bucket, or into one. */}
                    <Td className="tnum text-end font-medium">
                      <span className={quantity < 0 ? 'text-danger' : 'text-success'}>
                        {quantity > 0 ? `+${quantity}` : quantity}
                      </span>
                    </Td>
                    <Td className="text-ink-muted">{wh?.name ?? '—'}</Td>
                    <Td className="text-xs text-ink-muted">{row.reason ?? '—'}</Td>
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
