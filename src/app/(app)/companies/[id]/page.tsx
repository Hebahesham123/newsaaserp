import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
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
  Meter,
  PageHeader,
  StatTile,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import { DateOnly, OperatingModelLabel, StatusBadge } from '@/components/status-badge';
import { ActionButton } from '@/components/form/action-button';
import { CompanyForm } from '../company-form';
import { archiveCompany } from '../actions';

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('companies.view');
  const { id } = await params;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  const { data: company } = await supabase.from('companies').select('*').eq('id', id).maybeSingle();
  if (!company) notFound();

  const [merchants, stores, users, warehouses, { data: merchantRows }, { data: manager }] =
    await Promise.all([
      supabase.from('merchants').select('*', { count: 'exact', head: true }).eq('company_id', id).is('archived_at', null),
      supabase.from('stores').select('*', { count: 'exact', head: true }).eq('company_id', id).is('archived_at', null),
      supabase.from('app_users').select('*', { count: 'exact', head: true }).eq('company_id', id).is('archived_at', null),
      supabase.from('warehouses').select('*', { count: 'exact', head: true }).eq('company_id', id).is('archived_at', null),
      supabase
        .from('merchants')
        .select('id, name, code, status, commission_percentage')
        .eq('company_id', id)
        .is('archived_at', null)
        .order('name')
        .limit(20),
      company.account_manager_id
        ? supabase.from('app_users').select('full_name').eq('id', company.account_manager_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const name = locale === 'ar' ? company.name_ar : company.name_en;

  return (
    <>
      <PageHeader
        breadcrumb={<Breadcrumb items={[{ label: t.companies.title, href: '/companies' }, { label: name }]} />}
        title={name}
        subtitle={company.trade_name ?? company.code}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={company.status} />
            {can(session, 'companies.edit') ? <CompanyForm company={company} /> : null}
            {can(session, 'companies.archive') ? (
              <ActionButton
                action={archiveCompany}
                fields={company.archived_at ? { id: company.id, restore: '1' } : { id: company.id }}
                label={company.archived_at ? t.common.unarchive : t.common.archive}
                icon={company.archived_at ? 'restore' : 'archive'}
                confirm={company.archived_at ? undefined : t.common.archiveConfirm}
                variant="ghost"
                size="md"
              />
            ) : null}
          </div>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t.companies.merchantCount} value={merchants.count ?? 0} />
        <StatTile label={t.companies.storeCount} value={stores.count ?? 0} tone="info" />
        <StatTile label={t.companies.userCount} value={users.count ?? 0} tone="success" />
        <StatTile label={t.warehouses.title} value={warehouses.count ?? 0} tone="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.common.details}</CardTitle>
          </CardHeader>
          <CardBody>
            <DetailList>
              <Detail label={t.common.code}>{company.code}</Detail>
              <Detail label={t.common.status}>
                <StatusBadge status={company.status} />
              </Detail>
              <Detail label={t.companies.nameAr}>{company.name_ar}</Detail>
              <Detail label={t.companies.nameEn}>{company.name_en}</Detail>
              <Detail label={t.companies.businessType}>{company.business_type}</Detail>
              <Detail label={t.companies.operatingModel}>
                <OperatingModelLabel model={company.operating_model} />
              </Detail>
              <Detail label={t.companies.accountManager}>{manager?.full_name}</Detail>
              <Detail label={t.companies.baseCurrency}>{company.base_currency}</Detail>
              <Detail label={t.common.locale}>{company.default_locale}</Detail>
              <Detail label={t.common.timezone}>{company.timezone}</Detail>
              <Detail label={t.common.country}>{company.country}</Detail>
              <Detail label={t.common.region}>{company.region}</Detail>
              <Detail label={t.common.email}>{company.email}</Detail>
              <Detail label={t.common.phone}>{company.phone}</Detail>
              <Detail label={t.common.website}>{company.website}</Detail>
              <Detail label={t.common.address}>{company.address}</Detail>
              <Detail label={t.companies.taxNumber}>{company.tax_registration_number}</Detail>
              <Detail label={t.companies.commercialRegistration}>
                {company.commercial_registration_number}
              </Detail>
            </DetailList>

            {company.internal_notes ? (
              <p className="mt-4 border-t border-border pt-3 text-sm text-ink-muted">
                {company.internal_notes}
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.companies.subscription}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <dl>
              <Detail label={t.companies.subscriptionPlan}>
                {company.subscription_plan ? <Badge tone="brand">{company.subscription_plan}</Badge> : null}
              </Detail>
              <Detail label={t.companies.subscriptionStarts}>
                <DateOnly value={company.subscription_start_date} />
              </Detail>
              <Detail label={t.companies.subscriptionEnds}>
                <DateOnly value={company.subscription_end_date} />
              </Detail>
            </dl>

            {/* Plan limits read better as usage bars than as "3 / 60". */}
            <div className="space-y-3 border-t border-border pt-3">
              {company.max_users ? (
                <Meter
                  value={users.count ?? 0}
                  max={company.max_users}
                  label={`${t.companies.userCount} ${users.count ?? 0} / ${company.max_users}`}
                />
              ) : null}
              {company.max_stores ? (
                <Meter
                  value={stores.count ?? 0}
                  max={company.max_stores}
                  label={`${t.companies.storeCount} ${stores.count ?? 0} / ${company.max_stores}`}
                />
              ) : null}
              {company.max_monthly_orders ? (
                <Detail label={t.companies.maxMonthlyOrders}>
                  <span className="tnum">{company.max_monthly_orders.toLocaleString('en-GB')}</span>
                </Detail>
              ) : null}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>{t.merchants.title}</CardTitle>
          </CardHeader>
          {!merchantRows || merchantRows.length === 0 ? (
            <EmptyState title={t.common.noResults} hint={t.merchants.subtitle} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t.common.code}</Th>
                  <Th>{t.common.name}</Th>
                  <Th>{t.common.status}</Th>
                  <Th className="text-end">{t.merchants.commission}</Th>
                </tr>
              </thead>
              <tbody>
                {merchantRows.map((merchant) => (
                  <Tr key={merchant.id}>
                    <Td className="tnum font-medium">{merchant.code}</Td>
                    <Td>
                      <Link href={`/merchants/${merchant.id}`} className="text-brand hover:underline">
                        {merchant.name}
                      </Link>
                    </Td>
                    <Td>
                      <StatusBadge status={merchant.status} />
                    </Td>
                    <Td className="tnum text-end text-ink-muted">
                      {merchant.commission_percentage != null ? `${merchant.commission_percentage}%` : '—'}
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
