import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  Badge,
  Breadcrumb,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Detail,
  DetailList,
  EmptyState,
  Notice,
  PageHeader,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { DateTime, PlatformLabel, StatusBadge } from '@/components/status-badge';
import { ActionButton } from '@/components/form/action-button';
import { StoreForm } from '../store-form';
import { archiveStore, setStoreStatus, triggerSync } from '../actions';

export default async function StoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('stores.view');
  const { id } = await params;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const { data: store } = await supabase
    .from('stores')
    .select('*, merchants(id, name, code)')
    .eq('id', id)
    .maybeSingle();

  if (!store) notFound();

  const merchant = store.merchants as unknown as { id: string; name: string; code: string } | null;

  const [{ data: syncRuns }, { data: merchants }, { data: warehouses }, { data: staff }] =
    await Promise.all([
      supabase
        .from('sync_log')
        .select('*')
        .eq('store_id', id)
        .order('started_at', { ascending: false })
        .limit(10),
      supabase.from('merchants').select('id, name').is('archived_at', null).order('name'),
      supabase.from('warehouses').select('id, name').is('archived_at', null).order('name'),
      supabase.from('app_users').select('id, full_name').is('archived_at', null).order('full_name'),
    ]);

  const webhookPath = `/api/webhooks/${store.provider}/${store.id}`;
  const canEdit = can(session, 'stores.edit');
  const connected = store.status === 'connected' || store.status === 'active';

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[
              { label: t.stores.title, href: '/stores' },
              { label: store.name },
            ]}
          />
        }
        title={store.name}
        subtitle={merchant ? `${merchant.name} · ${store.code}` : store.code}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={store.status} />

            {can(session, 'stores.sync.trigger') ? (
              <ActionButton
                action={triggerSync}
                fields={{ storeId: store.id, entity: 'orders' }}
                label={t.stores.syncNow}
                icon="sync"
                variant="secondary"
                size="md"
              />
            ) : null}

            {can(session, 'stores.connect') && !connected ? (
              <ActionButton
                action={setStoreStatus}
                fields={{ id: store.id, status: 'connected' }}
                label={t.stores.connect}
                variant="secondary"
                size="md"
              />
            ) : null}

            {can(session, 'stores.disconnect') && connected ? (
              <ActionButton
                action={setStoreStatus}
                fields={{ id: store.id, status: 'disconnected' }}
                label={t.stores.disconnect}
                variant="secondary"
                size="md"
                confirm={`${t.stores.disconnect}?`}
              />
            ) : null}

            {canEdit && store.status !== 'temporarily_suspended' ? (
              <ActionButton
                action={setStoreStatus}
                fields={{ id: store.id, status: 'temporarily_suspended' }}
                label={t.stores.suspend}
                variant="ghost"
                size="md"
              />
            ) : null}

            {canEdit ? (
              <StoreForm
                store={store}
                merchants={(merchants ?? []).map((m) => ({ id: m.id, name: m.name }))}
                warehouses={(warehouses ?? []).map((w) => ({ id: w.id, name: w.name }))}
                managers={(staff ?? []).map((u) => ({ id: u.id, name: u.full_name }))}
              />
            ) : null}

            {can(session, 'stores.archive') ? (
              <ActionButton
                action={archiveStore}
                fields={store.archived_at ? { id: store.id, restore: '1' } : { id: store.id }}
                label={store.archived_at ? t.common.unarchive : t.common.archive}
                icon={store.archived_at ? 'restore' : 'archive'}
                confirm={store.archived_at ? undefined : t.common.archiveConfirm}
                variant="ghost"
                size="md"
              />
            ) : null}
          </div>
        }
      />

      {store.provider === 'mock' ? (
        <div className="mb-4">
          <Notice tone="info" title={t.stores.providerMock}>
            {t.stores.mockNotice}
          </Notice>
        </div>
      ) : null}

      {store.last_sync_error ? (
        <div className="mb-4">
          <Notice tone="danger" title={t.status.connection_error}>
            {store.last_sync_error}
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.common.details}</CardTitle>
          </CardHeader>
          <CardBody>
            <DetailList>
              <Detail label={t.common.code}>{store.code}</Detail>
              <Detail label={t.stores.platform}>
                <PlatformLabel platform={store.platform} />
              </Detail>
              <Detail label={t.stores.merchant}>
                {merchant ? (
                  <Link href={`/merchants/${merchant.id}`} className="text-brand hover:underline">
                    {merchant.name}
                  </Link>
                ) : null}
              </Detail>
              <Detail label={t.stores.provider}>
                <Badge tone={store.provider === 'mock' ? 'info' : 'brand'}>{store.provider}</Badge>
              </Detail>
              <Detail label={t.stores.storeUrl}>
                {store.store_url ? (
                  <span dir="ltr" className="break-all">
                    {store.store_url}
                  </span>
                ) : null}
              </Detail>
              <Detail label={t.common.currency}>{store.currency}</Detail>
              <Detail label={t.common.country}>{store.country}</Detail>
              <Detail label={t.common.timezone}>{store.timezone}</Detail>
              <Detail label={t.stores.syncEnabled}>
                <Badge tone={store.sync_enabled ? 'success' : 'neutral'}>
                  {store.sync_enabled ? t.common.yes : t.common.no}
                </Badge>
              </Detail>
              <Detail label={t.stores.lastSync}>
                <DateTime value={store.last_sync_at} />
              </Detail>
              <Detail label={t.stores.orderImportMethod}>{store.order_import_method}</Detail>
              <Detail label={t.stores.inventorySyncMethod}>{store.inventory_sync_method}</Detail>
            </DetailList>

            {store.notes ? (
              <p className="mt-4 border-t border-border pt-3 text-sm text-ink-muted">{store.notes}</p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.stores.webhookEndpoint}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-xs text-ink-muted">{t.stores.webhookHint}</p>
            <code
              dir="ltr"
              className="block rounded-lg bg-surface-muted px-3 py-2 text-xs break-all text-ink-muted"
            >
              {webhookPath}
            </code>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>{t.stores.syncHistory}</CardTitle>
          </CardHeader>
          {!syncRuns || syncRuns.length === 0 ? (
            <EmptyState title={t.common.noResults} hint={t.sync.subtitle} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t.sync.entity}</Th>
                  <Th>{t.sync.trigger}</Th>
                  <Th>{t.common.status}</Th>
                  <Th className="text-end">{t.sync.received}</Th>
                  <Th className="text-end">{t.sync.succeeded}</Th>
                  <Th className="text-end">{t.sync.failed}</Th>
                  <Th className="text-end">{t.sync.duration}</Th>
                  <Th>{t.sync.startedAt}</Th>
                </tr>
              </thead>
              <tbody>
                {syncRuns.map((run) => (
                  <Tr key={run.id}>
                    <Td className="text-ink-muted">{run.entity}</Td>
                    <Td className="text-ink-muted">{run.trigger_source}</Td>
                    <Td>
                      <StatusBadge status={run.status} />
                    </Td>
                    <Td className="tnum text-end">{run.records_received}</Td>
                    <Td className="tnum text-end">{run.records_succeeded}</Td>
                    <Td className="tnum text-end">
                      {run.records_failed > 0 ? (
                        <span className="text-danger">{run.records_failed}</span>
                      ) : (
                        run.records_failed
                      )}
                    </Td>
                    <Td className="tnum text-end text-ink-muted">
                      {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : '—'}
                    </Td>
                    <Td className="text-ink-muted">
                      <DateTime value={run.started_at} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
