import Link from 'next/link';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { DateOnly, OperatingModelLabel, StatusBadge } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { ActionButton } from '@/components/form/action-button';
import { pickFilter, searchTerm } from '@/lib/filters';
import { CompanyForm } from './company-form';
import { archiveCompany } from './actions';

const STATUSES = [
  'draft', 'under_review', 'active', 'suspended',
  'temporarily_blocked', 'subscription_expired', 'cancelled', 'archived',
] as const;

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; archived?: string }>;
}) {
  const session = await requirePermission('companies.view');
  const { q, status, archived } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase.from('companies').select('*').order('created_at', { ascending: false });

  const term = searchTerm(q);
  if (term) {
    // Trigram indexes back name_en/name_ar; code is short enough for a scan.
    query = query.or(`name_en.ilike.%${term}%,name_ar.ilike.%${term}%,code.ilike.%${term}%`);
  }

  const statusFilter = pickFilter(status, STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);

  const { data: companies } = await query;
  const canEdit = can(session, 'companies.edit');
  const canArchive = can(session, 'companies.archive');

  return (
    <>
      <PageHeader
        title={t.companies.title}
        subtitle={t.companies.subtitle}
        actions={can(session, 'companies.create') ? <CompanyForm /> : null}
      />

      <Toolbar
        placeholder={t.companies.title}
        filters={[
          {
            name: 'status',
            label: t.common.status,
            options: STATUSES.map((value) => ({ value, label: t.status[value] })),
          },
          {
            name: 'archived',
            label: t.common.archived,
            options: [{ value: '1', label: t.common.yes }],
          },
        ]}
      />

      <Card>
        {!companies || companies.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.companies.subtitle} />
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
                {canEdit || canArchive ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {companies.map((company) => (
                <Tr key={company.id}>
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
                  {canEdit || canArchive ? (
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        {canEdit ? <CompanyForm company={company} /> : null}
                        {canArchive ? (
                          <ActionButton
                            action={archiveCompany}
                            fields={
                              company.archived_at
                                ? { id: company.id, restore: '1' }
                                : { id: company.id }
                            }
                            label={company.archived_at ? t.common.unarchive : t.common.archive}
                            icon={company.archived_at ? 'restore' : 'archive'}
                            confirm={company.archived_at ? undefined : t.common.archiveConfirm}
                            iconOnly
                          />
                        ) : null}
                      </div>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {companies && companies.length > 0 ? (
        <p className="mt-3 text-xs text-ink-subtle">
          {t.common.showing} {companies.length} {t.common.results}
        </p>
      ) : null}
    </>
  );
}
