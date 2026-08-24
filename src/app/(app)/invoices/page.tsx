import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Card, EmptyState, Notice, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { DateOnly, EnumBadge, Money } from '@/components/status-badge';
import { ActionButton } from '@/components/form/action-button';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter, searchTerm } from '@/lib/filters';
import { setInvoiceStatus } from '../finance/actions';

const INVOICE_STATUSES = ['draft', 'approved', 'paid', 'cancelled'] as const;

/** §7.8 invoicing: draft → approved → paid, with cancellation as the only exit. */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; merchant?: string }>;
}) {
  const session = await requirePermission('finance.invoice.view');
  const { q, status, merchant } = await searchParams;
  const t = await getDictionary();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('invoices')
    .select('*, merchants(name)')
    .order('issue_date', { ascending: false })
    .limit(250);

  const term = searchTerm(q);
  if (term) query = query.ilike('invoice_number', `%${term}%`);

  const statusFilter = pickFilter(status, INVOICE_STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);
  if (merchant) query = query.eq('merchant_id', merchant);

  const [{ data: invoices }, { data: merchants }] = await Promise.all([
    query,
    supabase.from('merchants').select('id, name').is('archived_at', null).order('name'),
  ]);

  const canApprove = can(session, 'finance.invoice.approve');
  const canCreate = can(session, 'finance.invoice.create');

  return (
    <>
      <PageHeader title={t.invoices.title} subtitle={t.invoices.subtitle} />

      <div className="mb-4">
        <Notice tone="info">{t.invoices.lockedNotice}</Notice>
      </div>

      <Toolbar
        placeholder={t.invoices.invoiceNumber}
        filters={[
          {
            name: 'status',
            label: t.common.status,
            options: INVOICE_STATUSES.map((value) => ({ value, label: t.invoiceStatus[value] })),
          },
          {
            name: 'merchant',
            label: t.stores.merchant,
            options: (merchants ?? []).map((m) => ({ value: m.id, label: m.name })),
          },
        ]}
      />

      <Card>
        {!invoices || invoices.length === 0 ? (
          <EmptyState title={t.invoices.noInvoices} hint={t.invoices.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.invoices.invoiceNumber}</Th>
                <Th>{t.stores.merchant}</Th>
                <Th>{t.invoices.issueDate}</Th>
                <Th>{t.invoices.dueDate}</Th>
                <Th className="text-end">{t.invoices.subtotal}</Th>
                <Th className="text-end">{t.invoices.taxAmount}</Th>
                <Th className="text-end">{t.invoices.totalAmount}</Th>
                <Th>{t.common.status}</Th>
                {canApprove || canCreate ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => {
                const merchantRow = invoice.merchants as unknown as { name: string } | null;

                return (
                  <Tr key={invoice.id}>
                    <Td className="tnum font-medium" dir="ltr">{invoice.invoice_number}</Td>
                    <Td>{merchantRow?.name ?? '—'}</Td>
                    <Td className="text-ink-muted">
                      <DateOnly value={invoice.issue_date} />
                    </Td>
                    <Td className="text-ink-muted">
                      <DateOnly value={invoice.due_date} />
                    </Td>
                    <Td className="text-end text-ink-muted">
                      <Money amount={invoice.subtotal} currency={invoice.currency} />
                    </Td>
                    <Td className="text-end text-ink-muted">
                      <Money amount={invoice.tax_amount} currency={invoice.currency} />
                    </Td>
                    <Td className="text-end font-medium">
                      <Money amount={invoice.total} currency={invoice.currency} />
                    </Td>
                    <Td>
                      <EnumBadge section="invoiceStatus" value={invoice.status} />
                    </Td>
                    {canApprove || canCreate ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          {canApprove && invoice.status === 'draft' ? (
                            <ActionButton
                              action={setInvoiceStatus}
                              fields={{ id: invoice.id, status: 'approved' }}
                              label={t.invoices.approve}
                              icon="approve"
                              confirm={t.common.confirm}
                              iconOnly
                            />
                          ) : null}
                          {canCreate && invoice.status === 'approved' ? (
                            <ActionButton
                              action={setInvoiceStatus}
                              fields={{ id: invoice.id, status: 'paid' }}
                              label={t.invoices.markPaid}
                              icon="key"
                              iconOnly
                            />
                          ) : null}
                          {canCreate && ['draft', 'approved'].includes(invoice.status) ? (
                            <ActionButton
                              action={setInvoiceStatus}
                              fields={{ id: invoice.id, status: 'cancelled' }}
                              label={t.invoices.cancelInvoice}
                              icon="reject"
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
