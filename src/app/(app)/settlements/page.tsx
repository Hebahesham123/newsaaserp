import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, EmptyState, Notice, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { DateOnly, EnumBadge, Money } from '@/components/status-badge';
import { ActionButton } from '@/components/form/action-button';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter } from '@/lib/filters';
import { approveSettlement, calculateSettlement } from '../finance/actions';

const SETTLEMENT_STATUSES = ['draft', 'calculated', 'approved', 'paid', 'disputed'] as const;

/** §7.7 the periodic merchant statement. */
export default async function SettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; merchant?: string }>;
}) {
  const session = await requirePermission('finance.settlement.view');
  const { status, merchant } = await searchParams;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('merchant_settlements')
    .select('*, merchants(name)')
    .order('period_start', { ascending: false })
    .limit(200);

  const statusFilter = pickFilter(status, SETTLEMENT_STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);
  if (merchant) query = query.eq('merchant_id', merchant);

  const [{ data: settlements }, { data: merchants }] = await Promise.all([
    query,
    supabase.from('merchants').select('id, name').is('archived_at', null).order('name'),
  ]);

  const canRun = can(session, 'finance.settlement.run');
  const canApprove = can(session, 'finance.settlement.approve');

  return (
    <>
      <PageHeader title={t.settlements.title} subtitle={t.settlements.subtitle} />

      {canApprove ? (
        <div className="mb-4">
          <Notice tone="info">{t.settlements.approveBlocked}</Notice>
        </div>
      ) : null}

      <Toolbar
        filters={[
          {
            name: 'status',
            label: t.common.status,
            options: SETTLEMENT_STATUSES.map((value) => ({ value, label: t.settlementStatus[value] })),
          },
          {
            name: 'merchant',
            label: t.stores.merchant,
            options: (merchants ?? []).map((m) => ({ value: m.id, label: m.name })),
          },
        ]}
      />

      <Card>
        {!settlements || settlements.length === 0 ? (
          <EmptyState title={t.settlements.noSettlements} hint={t.settlements.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.settlements.settlementNumber}</Th>
                <Th>{t.stores.merchant}</Th>
                <Th>{t.settlements.period}</Th>
                <Th>{t.common.status}</Th>
                <Th className="text-end">{t.settlements.totalOrders}</Th>
                <Th className="text-end">{t.settlements.grossSales}</Th>
                <Th className="text-end">{t.settlements.collectedAmount}</Th>
                <Th className="text-end">{t.settlements.totalDeductions}</Th>
                <Th className="text-end">{t.settlements.netPayable}</Th>
                {canRun || canApprove ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {settlements.map((settlement) => {
                const merchantRow = settlement.merchants as unknown as { name: string } | null;
                const net = Number(settlement.net_payable);

                return (
                  <Tr key={settlement.id}>
                    <Td className="tnum font-medium" dir="ltr">{settlement.settlement_number}</Td>
                    <Td>{merchantRow?.name ?? '—'}</Td>
                    <Td className="text-ink-muted">
                      <DateOnly value={settlement.period_start} /> – <DateOnly value={settlement.period_end} />
                    </Td>
                    <Td>
                      <EnumBadge section="settlementStatus" value={settlement.status} />
                    </Td>
                    <Td className="tnum text-end text-ink-muted">{settlement.total_orders}</Td>
                    <Td className="text-end">
                      <Money amount={settlement.gross_sales} currency={settlement.currency} />
                    </Td>
                    <Td className="text-end">
                      <Money amount={settlement.collected_amount} currency={settlement.currency} />
                    </Td>
                    <Td className="text-end text-ink-muted">
                      <Money amount={settlement.total_deductions} currency={settlement.currency} />
                    </Td>
                    <Td className="text-end font-medium">
                      <span className={net < 0 ? 'text-danger' : undefined}>
                        <Money amount={net} currency={settlement.currency} />
                      </span>
                    </Td>
                    {canRun || canApprove ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          {canRun && !['approved', 'paid'].includes(settlement.status) ? (
                            <ActionButton
                              action={calculateSettlement}
                              fields={{ id: settlement.id }}
                              label={t.settlements.calculate}
                              icon="sync"
                              iconOnly
                            />
                          ) : null}
                          {canApprove && settlement.status === 'calculated' ? (
                            <ActionButton
                              action={approveSettlement}
                              fields={{ id: settlement.id }}
                              label={t.settlements.approve}
                              icon="approve"
                              confirm={t.common.confirm}
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
    </>
  );
}
