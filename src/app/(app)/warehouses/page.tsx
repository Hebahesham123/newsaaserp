import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { Toolbar } from '@/components/form/toolbar';
import { ActionButton } from '@/components/form/action-button';
import { pickFilter, searchTerm } from '@/lib/filters';
import { WarehouseForm } from './warehouse-form';
import { archiveWarehouse } from './actions';

const TYPES = [
  'main', 'fulfillment', 'retail_store', 'branch', 'marketplace', 'returns', 'temporary', 'damaged',
] as const;

export default async function WarehousesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; warehouse_type?: string; archived?: string }>;
}) {
  const session = await requirePermission('warehouses.view');
  const { q, warehouse_type: type, archived } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('warehouses')
    .select('*, merchants(id, name), app_users!warehouses_manager_fk(full_name)')
    .order('name');

  const term = searchTerm(q);
  if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`);

  const typeFilter = pickFilter(type, TYPES);
  if (typeFilter) query = query.eq('warehouse_type', typeFilter);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);

  const [{ data: warehouses }, { data: merchants }, { data: staff }, companiesResult] =
    await Promise.all([
      query,
      supabase.from('merchants').select('id, name').is('archived_at', null).order('name'),
      supabase.from('app_users').select('id, full_name').is('archived_at', null).order('full_name'),
      session.profile.company_id
        ? Promise.resolve({ data: null })
        : supabase.from('companies').select('id, name_en, name_ar').is('archived_at', null).order('name_en'),
    ]);

  const merchantOptions = (merchants ?? []).map((m) => ({ id: m.id, name: m.name }));
  const managerOptions = (staff ?? []).map((u) => ({ id: u.id, name: u.full_name }));
  const companyOptions = (companiesResult.data ?? []).map((c) => ({
    id: c.id,
    name: locale === 'ar' ? c.name_ar : c.name_en,
  }));

  const canCreate = can(session, 'warehouses.create');
  const canEdit = can(session, 'warehouses.edit');

  return (
    <>
      <PageHeader
        title={t.warehouses.title}
        subtitle={t.warehouses.subtitle}
        actions={
          canCreate ? (
            <WarehouseForm
              merchants={merchantOptions}
              managers={managerOptions}
              companies={session.profile.company_id ? undefined : companyOptions}
            />
          ) : null
        }
      />

      <Toolbar
        placeholder={t.warehouses.title}
        filters={[
          {
            name: 'warehouse_type',
            label: t.common.type,
            options: TYPES.map((value) => ({ value, label: t.warehouseType[value] })),
          },
          { name: 'archived', label: t.common.archived, options: [{ value: '1', label: t.common.yes }] },
        ]}
      />

      <Card>
        {!warehouses || warehouses.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.warehouses.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.common.type}</Th>
                <Th>{t.stores.merchant}</Th>
                <Th>{t.warehouses.manager}</Th>
                <Th>{t.common.region}</Th>
                <Th className="text-end">{t.warehouses.capacityCbm}</Th>
                <Th>{t.common.status}</Th>
                {canEdit ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {warehouses.map((warehouse) => {
                const merchant = warehouse.merchants as unknown as { id: string; name: string } | null;
                const manager = warehouse.app_users as unknown as { full_name: string } | null;
                const settings = (warehouse.settings ?? {}) as { capacity_cbm?: number };
                const typeKey = warehouse.warehouse_type as (typeof TYPES)[number];

                return (
                  <Tr key={warehouse.id}>
                    <Td className="tnum font-medium">{warehouse.code}</Td>
                    <Td>{warehouse.name}</Td>
                    <Td className="text-ink-muted">{t.warehouseType[typeKey] ?? warehouse.warehouse_type}</Td>
                    <Td className="text-ink-muted">
                      {merchant?.name ?? <span className="text-ink-subtle">{t.warehouses.shared}</span>}
                    </Td>
                    <Td className="text-ink-muted">{manager?.full_name ?? '—'}</Td>
                    <Td className="text-ink-muted">{warehouse.region ?? '—'}</Td>
                    <Td className="tnum text-end text-ink-muted">
                      {settings.capacity_cbm ? settings.capacity_cbm.toLocaleString('en-GB') : '—'}
                    </Td>
                    <Td>
                      <Badge tone={warehouse.is_active ? 'success' : 'neutral'}>
                        {warehouse.is_active ? t.common.active : t.common.inactive}
                      </Badge>
                    </Td>
                    {canEdit ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <WarehouseForm
                            warehouse={warehouse}
                            merchants={merchantOptions}
                            managers={managerOptions}
                          />
                          <ActionButton
                            action={archiveWarehouse}
                            fields={
                              warehouse.archived_at
                                ? { id: warehouse.id, restore: '1' }
                                : { id: warehouse.id }
                            }
                            label={warehouse.archived_at ? t.common.unarchive : t.common.archive}
                            icon={warehouse.archived_at ? 'restore' : 'archive'}
                            confirm={warehouse.archived_at ? undefined : t.common.archiveConfirm}
                            iconOnly
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
