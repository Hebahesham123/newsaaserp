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
  CardHeaderRow,
  CardTitle,
  Detail,
  DetailList,
  EmptyState,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { DateOnly, OperatingModelLabel, PlatformLabel, StatusBadge } from '@/components/status-badge';
import { ActionButton } from '@/components/form/action-button';
import { StoreForm } from '../../stores/store-form';
import { MerchantForm } from '../merchant-form';
import { PricingForm } from './pricing-form';
import { archiveMerchant } from '../actions';

export default async function MerchantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('merchants.view');
  const { id } = await params;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  const { data: merchant } = await supabase.from('merchants').select('*').eq('id', id).maybeSingle();
  if (!merchant) notFound();

  const [{ data: stores }, { data: warehouses }, { data: staff }, { data: allMerchants }] =
    await Promise.all([
      supabase
        .from('stores')
        .select('*')
        .eq('merchant_id', id)
        .is('archived_at', null)
        .order('created_at', { ascending: false }),
      supabase.from('warehouses').select('id, name').is('archived_at', null).order('name'),
      supabase.from('app_users').select('id, full_name').is('archived_at', null).order('full_name'),
      supabase.from('merchants').select('id, name').is('archived_at', null).order('name'),
    ]);

  const showPricing = can(session, 'merchants.pricing.view');
  const pricing = (merchant.service_pricing ?? {}) as Record<string, number>;
  const activeStores = (stores ?? []).filter((store) => store.status === 'active').length;
  const syncingStores = (stores ?? []).filter((store) => store.sync_enabled).length;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb
            items={[{ label: t.merchants.title, href: '/merchants' }, { label: merchant.name }]}
          />
        }
        title={merchant.name}
        subtitle={merchant.trade_name ?? merchant.code}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={merchant.status} />
            {showPricing && can(session, 'merchants.pricing.edit') ? (
              <PricingForm merchantId={merchant.id} pricing={merchant.service_pricing} />
            ) : null}
            {can(session, 'merchants.edit') ? <MerchantForm merchant={merchant} /> : null}
            {can(session, 'merchants.archive') ? (
              <ActionButton
                action={archiveMerchant}
                fields={merchant.archived_at ? { id: merchant.id, restore: '1' } : { id: merchant.id }}
                label={merchant.archived_at ? t.common.unarchive : t.common.archive}
                icon={merchant.archived_at ? 'restore' : 'archive'}
                confirm={merchant.archived_at ? undefined : t.common.archiveConfirm}
                variant="ghost"
                size="md"
              />
            ) : null}
          </div>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t.merchants.storesCount} value={stores?.length ?? 0} />
        <StatTile label={t.dashboard.activeStores} value={activeStores} tone="success" />
        <StatTile label={t.stores.syncEnabled} value={syncingStores} tone="info" />
        <StatTile
          label={t.merchants.commission}
          value={merchant.commission_percentage != null ? `${merchant.commission_percentage}%` : '—'}
          hint={merchant.settlement_cycle ?? undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.common.details}</CardTitle>
          </CardHeader>
          <CardBody>
            <DetailList>
              <Detail label={t.common.code}>{merchant.code}</Detail>
              <Detail label={t.companies.operatingModel}>
                <OperatingModelLabel model={merchant.operating_model} />
              </Detail>
              <Detail label={t.merchants.merchantType}>{merchant.merchant_type}</Detail>
              <Detail label={t.merchants.contactPerson}>{merchant.contact_person}</Detail>
              <Detail label={t.common.email}>{merchant.email}</Detail>
              <Detail label={t.common.phone}>{merchant.phone}</Detail>
              <Detail label={t.common.country}>{merchant.country}</Detail>
              <Detail label={t.common.address}>{merchant.address}</Detail>
              <Detail label={t.common.currency}>{merchant.currency}</Detail>
              <Detail label={t.merchants.settlementCycle}>{merchant.settlement_cycle}</Detail>
              <Detail label={t.merchants.paymentTerms}>{merchant.payment_terms}</Detail>
              <Detail label={t.companies.taxNumber}>{merchant.tax_registration_number}</Detail>
              <Detail label={t.merchants.contractDate}>
                <DateOnly value={merchant.contract_date} />
              </Detail>
              <Detail label={t.merchants.goLiveDate}>
                <DateOnly value={merchant.go_live_date} />
              </Detail>
              {showPricing ? (
                <>
                  <Detail label={t.merchants.commission}>
                    {merchant.commission_percentage != null ? `${merchant.commission_percentage}%` : null}
                  </Detail>
                  <Detail label={t.merchants.creditLimit}>
                    {merchant.credit_limit != null
                      ? `${merchant.credit_limit.toLocaleString('en-GB')} ${merchant.currency}`
                      : null}
                  </Detail>
                </>
              ) : null}
            </DetailList>

            {merchant.internal_notes ? (
              <p className="mt-4 border-t border-border pt-3 text-sm text-ink-muted">
                {merchant.internal_notes}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <div className="space-y-4">
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
                      {t.merchantService[service] ?? service.replace(/_/g, ' ')}
                    </Badge>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          {showPricing ? (
            <Card>
              <CardHeader>
                <CardTitle>{t.merchants.servicePricing}</CardTitle>
              </CardHeader>
              <CardBody>
                {Object.keys(pricing).length === 0 ? (
                  <p className="text-sm text-ink-subtle">—</p>
                ) : (
                  <dl>
                    {Object.entries(pricing).map(([key, value]) => (
                      <Detail key={key} label={key.replace(/_/g, ' ')}>
                        <span className="tnum">
                          {value} {merchant.currency}
                        </span>
                      </Detail>
                    ))}
                  </dl>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeaderRow title={t.stores.title} hint={t.stores.subtitle}>
            {can(session, 'stores.create') ? (
              <StoreForm
                merchants={(allMerchants ?? []).map((m) => ({ id: m.id, name: m.name }))}
                warehouses={(warehouses ?? []).map((w) => ({ id: w.id, name: w.name }))}
                managers={(staff ?? []).map((u) => ({ id: u.id, name: u.full_name }))}
                defaultMerchantId={merchant.id}
              />
            ) : null}
          </CardHeaderRow>

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
                  <Tr key={store.id}>
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
