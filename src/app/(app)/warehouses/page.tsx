import { requirePermission } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, Notice, PageHeader, Table, Td, Th } from '@/components/ui';

export default async function WarehousesPage() {
  await requirePermission('warehouses.view');
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const { data: warehouses } = await supabase
    .from('warehouses')
    .select('*, merchants(name)')
    .is('archived_at', null)
    .order('name');

  return (
    <>
      <PageHeader title={t.nav.warehouses} subtitle="Physical locations where stock is held and orders fulfilled" />

      <div className="mb-4">
        <Notice tone="info">
          Phase 1 registers warehouses so stores can be assigned a default. Zones, aisles, bins, tasks and the
          inventory ledger arrive in Phase 4 (§5).
        </Notice>
      </div>

      <Card>
        {!warehouses || warehouses.length === 0 ? (
          <EmptyState title={t.common.noResults} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th>Type</Th>
                <Th>{t.stores.merchant}</Th>
                <Th>{t.common.country}</Th>
                <Th>{t.common.status}</Th>
              </tr>
            </thead>
            <tbody>
              {warehouses.map((warehouse) => {
                const merchant = warehouse.merchants as unknown as { name: string } | null;
                return (
                  <tr key={warehouse.id} className="hover:bg-surface-muted">
                    <Td className="tnum font-medium">{warehouse.code}</Td>
                    <Td>{warehouse.name}</Td>
                    <Td className="text-ink-muted">{warehouse.warehouse_type.replace(/_/g, ' ')}</Td>
                    <Td className="text-ink-muted">{merchant?.name ?? <span className="text-ink-subtle">shared</span>}</Td>
                    <Td className="text-ink-muted">{warehouse.country ?? '—'}</Td>
                    <Td>
                      <Badge tone={warehouse.is_active ? 'success' : 'neutral'}>
                        {warehouse.is_active ? t.status.active : t.status.archived}
                      </Badge>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
