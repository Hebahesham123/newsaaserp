import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  EmptyState,
  Notice,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { DateTime, PlatformLabel, StatusBadge } from '@/components/status-badge';
import { triggerSync } from '../actions';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border py-2.5 last:border-0">
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children ?? '—'}</dd>
    </div>
  );
}

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

  const { data: syncRuns } = await supabase
    .from('sync_log')
    .select('*')
    .eq('store_id', id)
    .order('started_at', { ascending: false })
    .limit(10);

  const webhookPath = `/api/webhooks/${store.provider}/${store.id}`;

  return (
    <>
      <PageHeader
        title={store.name}
        subtitle={merchant ? `${merchant.name} · ${store.code}` : store.code}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={store.status} />
            {can(session, 'stores.sync.trigger') ? (
              <form action={triggerSync}>
                <input type="hidden" name="storeId" value={store.id} />
                <input type="hidden" name="entity" value="orders" />
                <Button type="submit" variant="secondary">
                  {t.stores.syncNow}
                </Button>
              </form>
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

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.common.details}</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid gap-x-8 sm:grid-cols-2">
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
              <Detail label={t.stores.syncEnabled}>{store.sync_enabled ? t.common.yes : t.common.no}</Detail>
              <Detail label={t.stores.lastSync}>
                <DateTime value={store.last_sync_at} />
              </Detail>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Webhook endpoint</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-xs text-ink-muted">
              Register this URL in the channel once credentials are available. Requests are rejected unless
              the HMAC signature verifies.
            </p>
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
            <CardTitle>{t.sync.title}</CardTitle>
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
                  <Th>{t.sync.startedAt}</Th>
                </tr>
              </thead>
              <tbody>
                {syncRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-surface-muted">
                    <Td className="text-ink-muted">{run.entity}</Td>
                    <Td className="text-ink-muted">{run.trigger_source}</Td>
                    <Td>
                      <StatusBadge status={run.status} />
                    </Td>
                    <Td className="tnum text-end">{run.records_received}</Td>
                    <Td className="tnum text-end">{run.records_succeeded}</Td>
                    <Td className="tnum text-end">{run.records_failed}</Td>
                    <Td className="text-ink-muted">
                      <DateTime value={run.started_at} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
