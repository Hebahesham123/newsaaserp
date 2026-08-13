import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { DateOnly, OperatingModelLabel, PlatformLabel, StatusBadge } from '@/components/status-badge';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border py-2.5 last:border-0">
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children ?? '—'}</dd>
    </div>
  );
}

export default async function MerchantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('merchants.view');
  const { id } = await params;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const { data: merchant } = await supabase.from('merchants').select('*').eq('id', id).maybeSingle();
  if (!merchant) notFound();

  const { data: stores } = await supabase
    .from('stores')
    .select('*')
    .eq('merchant_id', id)
    .is('archived_at', null)
    .order('created_at', { ascending: false });

  const showPricing = can(session, 'merchants.pricing.view');

  return (
    <>
      <PageHeader
        title={merchant.name}
        subtitle={merchant.trade_name ?? merchant.code}
        actions={<StatusBadge status={merchant.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.common.details}</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid gap-x-8 sm:grid-cols-2">
              <Detail label={t.common.code}>{merchant.code}</Detail>
              <Detail label={t.companies.operatingModel}>
                <OperatingModelLabel model={merchant.operating_model} />
              </Detail>
              <Detail label={t.merchants.contactPerson}>{merchant.contact_person}</Detail>
              <Detail label={t.common.email}>{merchant.email}</Detail>
              <Detail label={t.common.phone}>{merchant.phone}</Detail>
              <Detail label={t.common.country}>{merchant.country}</Detail>
              <Detail label={t.common.currency}>{merchant.currency}</Detail>
              <Detail label={t.merchants.settlementCycle}>{merchant.settlement_cycle}</Detail>
              <Detail label={t.merchants.contractDate}>
                <DateOnly value={merchant.contract_date} />
              </Detail>
              <Detail label={t.merchants.goLiveDate}>
                <DateOnly value={merchant.go_live_date} />
              </Detail>
              {showPricing ? (
                <>
                  <Detail label={t.merchants.commission}>
                    {merchant.commission_percentage != null ? `${merchant.commission_percentage}%` : '—'}
                  </Detail>
                  <Detail label={t.merchants.creditLimit}>
                    {merchant.credit_limit != null ? merchant.credit_limit : '—'}
                  </Detail>
                </>
              ) : null}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.merchants.services}</CardTitle>
          </CardHeader>
          <CardBody>
            {merchant.services.length === 0 ? (
              <p className="text-sm text-ink-subtle">—</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {merchant.services.map((service) => (
                  <Badge key={service} tone="brand">
                    {service.replace(/_/g, ' ')}
                  </Badge>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>{t.stores.title}</CardTitle>
            {can(session, 'stores.create') ? (
              <Link href={`/stores/new?merchant=${merchant.id}`} className="text-sm text-brand hover:underline">
                {t.common.create}
              </Link>
            ) : null}
          </CardHeader>
          {!stores || stores.length === 0 ? (
            <EmptyState title={t.common.noResults} hint={t.stores.subtitle} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t.common.name}</Th>
                  <Th>{t.stores.platform}</Th>
                  <Th>{t.common.status}</Th>
                  <Th>{t.stores.provider}</Th>
                  <Th>{t.stores.lastSync}</Th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => (
                  <tr key={store.id} className="hover:bg-surface-muted">
                    <Td>
                      <Link href={`/stores/${store.id}`} className="text-brand hover:underline">
                        {store.name}
                      </Link>
                    </Td>
                    <Td className="text-ink-muted">
                      <PlatformLabel platform={store.platform} />
                    </Td>
                    <Td>
                      <StatusBadge status={store.status} />
                    </Td>
                    <Td className="text-ink-muted">{store.provider}</Td>
                    <Td className="text-ink-muted">
                      <DateOnly value={store.last_sync_at} />
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
