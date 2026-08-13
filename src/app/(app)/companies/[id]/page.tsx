import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, CardBody, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import { DateOnly, OperatingModelLabel, StatusBadge } from '@/components/status-badge';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border py-2.5 last:border-0">
      <dt className="text-xs text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children ?? '—'}</dd>
    </div>
  );
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('companies.view');
  const { id } = await params;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  const { data: company } = await supabase.from('companies').select('*').eq('id', id).maybeSingle();
  if (!company) notFound();

  const [merchants, stores, users] = await Promise.all([
    supabase.from('merchants').select('*', { count: 'exact', head: true }).eq('company_id', id),
    supabase.from('stores').select('*', { count: 'exact', head: true }).eq('company_id', id),
    supabase.from('app_users').select('*', { count: 'exact', head: true }).eq('company_id', id),
  ]);

  return (
    <>
      <PageHeader
        title={locale === 'ar' ? company.name_ar : company.name_en}
        subtitle={company.trade_name ?? company.code}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.common.details}</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="grid gap-x-8 sm:grid-cols-2">
              <Detail label={t.common.code}>{company.code}</Detail>
              <Detail label={t.common.status}>
                <StatusBadge status={company.status} />
              </Detail>
              <Detail label={t.companies.nameAr}>{company.name_ar}</Detail>
              <Detail label={t.companies.nameEn}>{company.name_en}</Detail>
              <Detail label={t.companies.operatingModel}>
                <OperatingModelLabel model={company.operating_model} />
              </Detail>
              <Detail label={t.companies.baseCurrency}>{company.base_currency}</Detail>
              <Detail label={t.common.country}>{company.country}</Detail>
              <Detail label={t.common.email}>{company.email}</Detail>
              <Detail label={t.common.phone}>{company.phone}</Detail>
              <Detail label={t.companies.taxNumber}>{company.tax_registration_number}</Detail>
              <Detail label={t.companies.commercialRegistration}>
                {company.commercial_registration_number}
              </Detail>
              <Detail label={t.companies.subscriptionEnds}>
                <DateOnly value={company.subscription_end_date} />
              </Detail>
            </dl>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t.common.settings}</CardTitle>
            </CardHeader>
            <CardBody>
              <dl>
                <Detail label={t.companies.merchantCount}>
                  <span className="tnum">
                    {merchants.count ?? 0}
                    {company.max_stores ? '' : ''}
                  </span>
                </Detail>
                <Detail label={t.companies.storeCount}>
                  <span className="tnum">
                    {stores.count ?? 0}
                    {company.max_stores ? ` / ${company.max_stores}` : ''}
                  </span>
                </Detail>
                <Detail label={t.companies.userCount}>
                  <span className="tnum">
                    {users.count ?? 0}
                    {company.max_users ? ` / ${company.max_users}` : ''}
                  </span>
                </Detail>
                <Detail label={t.companies.maxMonthlyOrders}>
                  <span className="tnum">{company.max_monthly_orders ?? '—'}</span>
                </Detail>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
