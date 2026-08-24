import Link from 'next/link';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { DateTime, PlatformLabel, StatusBadge } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { ActionButton } from '@/components/form/action-button';
import { pickFilter, searchTerm } from '@/lib/filters';
import { StoreForm } from './store-form';
import { archiveStore, triggerSync } from './actions';

const STATUSES = [
  'draft', 'not_connected', 'connection_in_progress', 'connected', 'active',
  'connection_error', 'temporarily_suspended', 'disconnected', 'archived',
] as const;

const PLATFORMS = [
  'shopify', 'woocommerce', 'amazon', 'noon', 'custom_store', 'mobile_app',
  'pos', 'branch', 'social_commerce', 'manual', 'wholesale', 'other_marketplace',
] as const;

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; platform?: string; archived?: string }>;
}) {
  const session = await requirePermission('stores.view');
  const { q, status, platform, archived } = await searchParams;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('stores')
    .select('*, merchants(id, name)')
    .order('created_at', { ascending: false });

  const term = searchTerm(q);
  if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%`);

  const statusFilter = pickFilter(status, STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);

  const platformFilter = pickFilter(platform, PLATFORMS);
  if (platformFilter) query = query.eq('platform', platformFilter);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);

  const [{ data: stores }, { data: merchants }, { data: warehouses }, { data: staff }] =
    await Promise.all([
      query,
      supabase.from('merchants').select('id, name').is('archived_at', null).order('name'),
      supabase.from('warehouses').select('id, name').is('archived_at', null).order('name'),
      supabase.from('app_users').select('id, full_name').is('archived_at', null).order('full_name'),
    ]);

  const merchantOptions = (merchants ?? []).map((m) => ({ id: m.id, name: m.name }));
  const warehouseOptions = (warehouses ?? []).map((w) => ({ id: w.id, name: w.name }));
  const managerOptions = (staff ?? []).map((u) => ({ id: u.id, name: u.full_name }));

  const canEdit = can(session, 'stores.edit');
  const canArchive = can(session, 'stores.archive');
  const canSync = can(session, 'stores.sync.trigger');

  return (
    <>
      <PageHeader
        title={t.stores.title}
        subtitle={t.stores.subtitle}
        actions={
          can(session, 'stores.create') && merchantOptions.length > 0 ? (
            <StoreForm
              merchants={merchantOptions}
              warehouses={warehouseOptions}
              managers={managerOptions}
            />
          ) : null
        }
      />

      <Toolbar
        placeholder={t.stores.title}
        filters={[
          {
            name: 'status',
            label: t.common.status,
            options: STATUSES.map((value) => ({ value, label: t.status[value] })),
          },
          {
            name: 'platform',
            label: t.stores.platform,
            options: PLATFORMS.map((value) => ({ value, label: t.platform[value] })),
          },
          { name: 'archived', label: t.common.archived, options: [{ value: '1', label: t.common.yes }] },
        ]}
      />

      <Card>
        {!stores || stores.length === 0 ? (
          <EmptyState
            title={t.common.noResults}
            hint={
              merchantOptions.length === 0
                ? t.merchants.noCompanyHint
                : t.stores.subtitle
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.stores.merchant}</Th>
                <Th>{t.stores.platform}</Th>
                <Th>{t.common.status}</Th>
                <Th>{t.stores.syncEnabled}</Th>
                <Th>{t.stores.lastSync}</Th>
                {canEdit || canArchive || canSync ? (
                  <Th className="text-end">{t.common.actions}</Th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => {
                const merchant = store.merchants as unknown as { id: string; name: string } | null;

                return (
                  <Tr key={store.id}>
                    <Td className="tnum font-medium">{store.code}</Td>
                    <Td>
                      <Link href={`/stores/${store.id}`} className="text-brand hover:underline">
                        {store.name}
                      </Link>
                      {store.last_sync_error ? (
                        <span className="block max-w-64 truncate text-xs text-danger" title={store.last_sync_error}>
                          {store.last_sync_error}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="text-ink-muted">
                      {merchant ? (
                        <Link href={`/merchants/${merchant.id}`} className="hover:text-ink hover:underline">
                          {merchant.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td className="text-ink-muted">
                      <PlatformLabel platform={store.platform} />
                    </Td>
                    <Td>
                      <StatusBadge status={store.status} />
                    </Td>
                    <Td>
                      <Badge tone={store.sync_enabled ? 'success' : 'neutral'}>
                        {store.sync_enabled ? t.common.yes : t.common.no}
                      </Badge>
                    </Td>
                    <Td className="text-ink-muted">
                      <DateTime value={store.last_sync_at} />
                    </Td>
                    {canEdit || canArchive || canSync ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          {canSync ? (
                            <ActionButton
                              action={triggerSync}
                              fields={{ storeId: store.id, entity: 'orders' }}
                              label={t.stores.syncNow}
                              icon="sync"
                              iconOnly
                            />
                          ) : null}
                          {canEdit ? (
                            <StoreForm
                              store={store}
                              merchants={merchantOptions}
                              warehouses={warehouseOptions}
                              managers={managerOptions}
                            />
                          ) : null}
                          {canArchive ? (
                            <ActionButton
                              action={archiveStore}
                              fields={
                                store.archived_at ? { id: store.id, restore: '1' } : { id: store.id }
                              }
                              label={store.archived_at ? t.common.unarchive : t.common.archive}
                              icon={store.archived_at ? 'restore' : 'archive'}
                              confirm={store.archived_at ? undefined : t.common.archiveConfirm}
                              iconOnly
                            />
                          ) : null}
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

      {stores && stores.length > 0 ? (
        <p className="mt-3 text-xs text-ink-subtle">
          {t.common.showing} {stores.length} {t.common.results}
        </p>
      ) : null}
    </>
  );
}
