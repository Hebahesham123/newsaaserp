import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, EmptyState, Notice, PageHeader, StatTile, Table, Td, Th, Tr } from '@/components/ui';
import { DateOnly, EnumBadge, Money } from '@/components/status-badge';
import { ActionButton } from '@/components/form/action-button';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter, searchTerm } from '@/lib/filters';
import { approveExpense } from '../finance/actions';

const EXPENSE_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'paid'] as const;

/** §7.10 operating expenses, and §7.12 rule 4 — every one carries a category. */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; category?: string }>;
}) {
  const session = await requirePermission('finance.expenses.view');
  const { q, status, category } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('operating_expenses')
    .select('*, expense_categories(name_en, name_ar), app_users!operating_expenses_submitted_by_fkey(full_name)')
    .order('incurred_on', { ascending: false })
    .limit(250);

  const term = searchTerm(q);
  if (term) query = query.or(`description.ilike.%${term}%,expense_number.ilike.%${term}%,vendor.ilike.%${term}%`);

  const statusFilter = pickFilter(status, EXPENSE_STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);
  if (category) query = query.eq('category_id', category);

  const [{ data: expenses }, { data: categories }, pendingCount] = await Promise.all([
    query,
    supabase.from('expense_categories').select('id, name_en, name_ar').eq('is_active', true).order('sort_order'),
    supabase
      .from('operating_expenses')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted'),
  ]);

  const canApprove = can(session, 'finance.expenses.approve');

  const approvedTotal = (expenses ?? [])
    .filter((expense) => ['approved', 'paid'].includes(expense.status))
    .reduce((sum, expense) => sum + Number(expense.amount), 0);

  return (
    <>
      <PageHeader title={t.expenses.title} subtitle={t.expenses.subtitle} />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <StatTile label={t.expenseStatus.submitted} value={pendingCount.count ?? 0} tone="warning" />
        <StatTile label={t.expenseStatus.approved} value={Math.round(approvedTotal)} tone="success" />
      </div>

      {canApprove ? (
        <div className="mb-4">
          <Notice tone="info">{t.expenses.sodNotice}</Notice>
        </div>
      ) : null}

      <Toolbar
        placeholder={t.expenses.expenseNumber}
        filters={[
          {
            name: 'status',
            label: t.common.status,
            options: EXPENSE_STATUSES.map((value) => ({ value, label: t.expenseStatus[value] })),
          },
          {
            name: 'category',
            label: t.expenses.category,
            options: (categories ?? []).map((c) => ({
              value: c.id,
              label: locale === 'ar' ? c.name_ar : c.name_en,
            })),
          },
        ]}
      />

      <Card>
        {!expenses || expenses.length === 0 ? (
          <EmptyState title={t.expenses.noExpenses} hint={t.expenses.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.expenses.expenseNumber}</Th>
                <Th>{t.common.description}</Th>
                <Th>{t.expenses.category}</Th>
                <Th>{t.expenses.incurredOn}</Th>
                <Th className="text-end">{t.expenses.amount}</Th>
                <Th>{t.common.status}</Th>
                <Th>{t.expenses.submittedBy}</Th>
                {canApprove ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => {
                const cat = expense.expense_categories as unknown as
                  | { name_en: string; name_ar: string }
                  | null;
                const submitter = expense.app_users as unknown as { full_name: string } | null;

                return (
                  <Tr key={expense.id}>
                    <Td className="tnum font-medium" dir="ltr">{expense.expense_number}</Td>
                    <Td>
                      {expense.description}
                      {expense.vendor ? (
                        <span className="block text-xs text-ink-subtle">{expense.vendor}</span>
                      ) : null}
                    </Td>
                    <Td className="text-ink-muted">
                      {cat ? (locale === 'ar' ? cat.name_ar : cat.name_en) : '—'}
                    </Td>
                    <Td className="text-ink-muted">
                      <DateOnly value={expense.incurred_on} />
                    </Td>
                    <Td className="text-end">
                      <Money amount={expense.amount} currency={expense.currency} />
                    </Td>
                    <Td>
                      <EnumBadge section="expenseStatus" value={expense.status} />
                    </Td>
                    <Td className="text-ink-muted">{submitter?.full_name ?? '—'}</Td>
                    {canApprove ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          {expense.status === 'submitted' ? (
                            <>
                              <ActionButton
                                action={approveExpense}
                                fields={{ id: expense.id }}
                                label={t.expenses.approve}
                                icon="approve"
                                iconOnly
                              />
                              <ActionButton
                                action={approveExpense}
                                fields={{ id: expense.id, reject: '1' }}
                                label={t.expenses.reject}
                                icon="reject"
                                confirm={t.common.confirm}
                                iconOnly
                              />
                            </>
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
