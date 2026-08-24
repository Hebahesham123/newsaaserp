import Link from 'next/link';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { DateOnly, OperatingModelLabel, StatusBadge } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { ActionButton } from '@/components/form/action-button';
import { pickFilter, searchTerm } from '@/lib/filters';
import { MerchantForm } from './merchant-form';
import { archiveMerchant } from './actions';

const STATUSES = [
  'lead', 'contracting', 'onboarding', 'ready_for_go_live', 'active',
  'temporarily_suspended', 'payment_overdue', 'on_hold', 'contract_terminated', 'archived',
] as const;

export default async function MerchantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; archived?: string }>;
}) {
  const session = await requirePermission('merchants.view');
  const { q, status, archived } = await searchParams;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('merchants')
    .select('*, stores(count)')
    .order('created_at', { ascending: false });

  const term = searchTerm(q);
  if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%,trade_name.ilike.%${term}%`);

  const statusFilter = pickFilter(status, STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);

  const [{ data: merchants }, companiesResult] = await Promise.all([
    query,
    // A platform admin has no implicit company, so the create form must offer
    // the ones they can see. Company-scoped users never see this list.
    session.profile.company_id
      ? Promise.resolve({ data: null })
      : supabase.from('companies').select('id, name_en').is('archived_at', null).order('name_en'),
  ]);

  const companyOptions = (companiesResult.data ?? []).map((company) => ({
    id: company.id,
    name: company.name_en,
  }));

  const canEdit = can(session, 'merchants.edit');
  const canArchive = can(session, 'merchants.archive');

  return (
    <>
      <PageHeader
        title={t.merchants.title}
        subtitle={t.merchants.subtitle}
        actions={
          can(session, 'merchants.create') ? (
            <MerchantForm companies={session.profile.company_id ? undefined : companyOptions} />
          ) : null
        }
      />

      <Toolbar
        placeholder={t.merchants.title}
        filters={[
          {
            name: 'status',
            label: t.common.status,
            options: STATUSES.map((value) => ({ value, label: t.status[value] })),
          },
          { name: 'archived', label: t.common.archived, options: [{ value: '1', label: t.common.yes }] },
        ]}
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
                <Th className="text-end">{t.nav.stores}</Th>
                <Th>{t.merchants.commission}</Th>
                <Th>{t.merchants.settlementCycle}</Th>
                <Th>{t.merchants.goLiveDate}</Th>
                {canEdit || canArchive ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {merchants.map((merchant) => {
                const storeCount =
                  (merchant.stores as unknown as { count: number }[] | null)?.[0]?.count ?? 0;

                return (
                  <Tr key={merchant.id}>
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
                    <Td className="tnum text-end text-ink-muted">{storeCount}</Td>
                    <Td className="tnum text-ink-muted">
                      {merchant.commission_percentage != null ? `${merchant.commission_percentage}%` : '—'}
                    </Td>
                    <Td className="text-ink-muted">
                      {merchant.settlement_cycle ? (
                        <Badge>{merchant.settlement_cycle}</Badge>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td className="text-ink-muted">
                      <DateOnly value={merchant.go_live_date} />
                    </Td>
                    {canEdit || canArchive ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          {canEdit ? <MerchantForm merchant={merchant} /> : null}
                          {canArchive ? (
                            <ActionButton
                              action={archiveMerchant}
                              fields={
                                merchant.archived_at
                                  ? { id: merchant.id, restore: '1' }
                                  : { id: merchant.id }
                              }
                              label={merchant.archived_at ? t.common.unarchive : t.common.archive}
                              icon={merchant.archived_at ? 'restore' : 'archive'}
                              confirm={merchant.archived_at ? undefined : t.common.archiveConfirm}
                              iconOnly
                            />
                          ) : null}
                        </div>
                      </Td>
                    ) : null}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {merchants && merchants.length > 0 ? (
        <p className="mt-3 text-xs text-ink-subtle">
          {t.common.showing} {merchants.length} {t.common.results}
        </p>
      ) : null}
    </>
  );
}
