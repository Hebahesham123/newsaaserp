import Link from 'next/link';
import { requirePermission } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { DateOnly, OperatingModelLabel, StatusBadge } from '@/components/status-badge';

export default async function CompaniesPage() {
  await requirePermission('companies.view');
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  const { data: companies } = await supabase
    .from('companies')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <>
      <PageHeader title={t.companies.title} subtitle={t.companies.subtitle} />

      <Card>
        {!companies || companies.length === 0 ? (
          <EmptyState title={t.common.noResults} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.companies.operatingModel}</Th>
                <Th>{t.common.status}</Th>
                <Th>{t.companies.baseCurrency}</Th>
                <Th>{t.companies.subscriptionPlan}</Th>
                <Th>{t.companies.subscriptionEnds}</Th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <tr key={company.id} className="hover:bg-surface-muted">
                  <Td className="tnum font-medium">{company.code}</Td>
                  <Td>
                    <Link href={`/companies/${company.id}`} className="text-brand hover:underline">
                      {locale === 'ar' ? company.name_ar : company.name_en}
                    </Link>
                    <span className="block text-xs text-ink-subtle">
                      {locale === 'ar' ? company.name_en : company.name_ar}
                    </span>
                  </Td>
                  <Td className="text-ink-muted">
                    <OperatingModelLabel model={company.operating_model} />
                  </Td>
                  <Td>
                    <StatusBadge status={company.status} />
                  </Td>
                  <Td className="tnum text-ink-muted">{company.base_currency}</Td>
                  <Td className="text-ink-muted">{company.subscription_plan ?? '—'}</Td>
                  <Td className="text-ink-muted">
                    <DateOnly value={company.subscription_end_date} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
