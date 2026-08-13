import Link from 'next/link';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Button, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { DateTime, PlatformLabel, StatusBadge } from '@/components/status-badge';

export default async function StoresPage() {
  const session = await requirePermission('stores.view');
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const { data: stores } = await supabase
    .from('stores')
    .select('*, merchants(name)')
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  return (
    <>
      <PageHeader
        title={t.stores.title}
        subtitle={t.stores.subtitle}
        actions={
          can(session, 'stores.create') ? (
            <Link href="/stores/new">
              <Button>{t.common.create}</Button>
            </Link>
          ) : null
        }
      />

      <Card>
        {!stores || stores.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.stores.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.stores.merchant}</Th>
                <Th>{t.stores.platform}</Th>
                <Th>{t.common.status}</Th>
                <Th>{t.stores.provider}</Th>
                <Th>{t.stores.lastSync}</Th>
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => {
                const merchant = store.merchants as unknown as { name: string } | null;
                return (
                  <tr key={store.id} className="hover:bg-surface-muted">
                    <Td className="tnum font-medium">{store.code}</Td>
                    <Td>
                      <Link href={`/stores/${store.id}`} className="text-brand hover:underline">
                        {store.name}
                      </Link>
                    </Td>
                    <Td className="text-ink-muted">{merchant?.name ?? '—'}</Td>
                    <Td className="text-ink-muted">
                      <PlatformLabel platform={store.platform} />
                    </Td>
                    <Td>
                      <StatusBadge status={store.status} />
                    </Td>
                    <Td>
                      {store.provider === 'mock' ? (
                        <Badge tone="info">mock</Badge>
                      ) : (
                        <Badge tone="brand">{store.provider}</Badge>
                      )}
                    </Td>
                    <Td className="text-ink-muted">
                      <DateTime value={store.last_sync_at} />
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
