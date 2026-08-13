import Link from 'next/link';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Button, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { DateOnly, OperatingModelLabel, StatusBadge } from '@/components/status-badge';

export default async function MerchantsPage() {
  const session = await requirePermission('merchants.view');
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const { data: merchants } = await supabase
    .from('merchants')
    .select('*, stores(count)')
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  return (
    <>
      <PageHeader
        title={t.merchants.title}
        subtitle={t.merchants.subtitle}
        actions={
          can(session, 'merchants.create') ? (
            <Link href="/merchants/new">
              <Button>{t.common.create}</Button>
            </Link>
          ) : null
        }
      />

      <Card>
        {!merchants || merchants.length === 0 ? (
          <EmptyState
            title={t.common.noResults}
            hint="Create a merchant to start connecting stores and receiving orders."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.common.status}</Th>
                <Th>{t.companies.operatingModel}</Th>
                <Th>{t.nav.stores}</Th>
                <Th>{t.merchants.settlementCycle}</Th>
                <Th>{t.merchants.goLiveDate}</Th>
              </tr>
            </thead>
            <tbody>
              {merchants.map((merchant) => {
                const storeCount =
                  (merchant.stores as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
                return (
                  <tr key={merchant.id} className="hover:bg-surface-muted">
                    <Td className="tnum font-medium">{merchant.code}</Td>
                    <Td>
                      <Link href={`/merchants/${merchant.id}`} className="text-brand hover:underline">
                        {merchant.name}
                      </Link>
                      {merchant.trade_name ? (
                        <span className="block text-xs text-ink-subtle">{merchant.trade_name}</span>
                      ) : null}
                    </Td>
                    <Td>
                      <StatusBadge status={merchant.status} />
                    </Td>
                    <Td className="text-ink-muted">
                      <OperatingModelLabel model={merchant.operating_model} />
                    </Td>
                    <Td className="tnum text-ink-muted">{storeCount}</Td>
                    <Td className="text-ink-muted">{merchant.settlement_cycle ?? '—'}</Td>
                    <Td className="text-ink-muted">
                      <DateOnly value={merchant.go_live_date} />
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
