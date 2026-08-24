import Link from 'next/link';
import { requirePermission, can, applyFieldPolicy } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { DateOnly, Money, RiskBadge } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { searchTerm } from '@/lib/filters';
import { CustomerForm, type Option } from '../orders/settings-forms';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; blacklisted?: string; risky?: string }>;
}) {
  const session = await requirePermission('orders.customer.view');
  const { q, blacklisted, risky } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('customers')
    .select('*')
    .is('archived_at', null)
    .order('last_order_at', { ascending: false, nullsFirst: false })
    .limit(200);

  const term = searchTerm(q);
  if (term) query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`);
  if (blacklisted) query = query.eq('is_blacklisted', true);
  if (risky) query = query.gte('risk_score', 30);

  const [{ data: customers }, companiesResult] = await Promise.all([
    query,
    session.profile.company_id
      ? Promise.resolve({ data: null })
      : supabase.from('companies').select('id, name_en, name_ar').is('archived_at', null).order('name_en'),
  ]);

  const companyOptions: Option[] | undefined = session.profile.company_id
    ? undefined
    : (companiesResult.data ?? []).map((c) => ({
        id: c.id,
        name: locale === 'ar' ? c.name_ar : c.name_en,
      }));

  const canEdit = can(session, 'orders.customer.edit');

  return (
    <>
      <PageHeader
        title={t.customers.title}
        subtitle={t.customers.subtitle}
        actions={canEdit ? <CustomerForm companies={companyOptions} /> : null}
      />

      <Toolbar
        placeholder={`${t.orders.customerName} / ${t.orders.phone}`}
        filters={[
          { name: 'blacklisted', label: t.customers.blacklisted, options: [{ value: '1', label: t.common.yes }] },
          { name: 'risky', label: t.orders.riskScore, options: [{ value: '1', label: '≥ 30' }] },
        ]}
      />

      <Card>
        {!customers || customers.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.customers.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.orders.customerName}</Th>
                <Th>{t.orders.phone}</Th>
                <Th>{t.orders.governorate}</Th>
                <Th className="text-end">{t.customers.ordersCount}</Th>
                <Th className="text-end">{t.customers.cancelledCount}</Th>
                <Th className="text-end">{t.customers.lifetimeValue}</Th>
                <Th className="text-end">{t.orders.riskScore}</Th>
                <Th>{t.customers.lastOrder}</Th>
                {canEdit ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => {
                // §2.7.3 — the phone is masked for roles that may not see it in full.
                const phone = applyFieldPolicy(session, 'customers', 'phone', customer.phone);

                return (
                  <Tr key={customer.id}>
                    <Td className="font-medium">
                      <Link href={`/customers/${customer.id}`} className="text-brand hover:underline">
                        {customer.name}
                      </Link>
                      {customer.is_blacklisted ? (
                        <Badge tone="danger" className="ms-2 text-[10px]">
                          {t.customers.blacklisted}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="tnum text-ink-muted" dir="ltr">
                      {phone ?? '—'}
                    </Td>
                    <Td className="text-ink-muted">{customer.governorate ?? '—'}</Td>
                    <Td className="tnum text-end">{customer.orders_count}</Td>
                    <Td className="tnum text-end text-ink-muted">{customer.cancelled_count}</Td>
                    <Td className="text-end">
                      <Money amount={customer.lifetime_value} />
                    </Td>
                    <Td className="text-end">
                      <RiskBadge score={customer.risk_score} />
                    </Td>
                    <Td className="text-ink-muted">
                      <DateOnly value={customer.last_order_at} />
                    </Td>
                    {canEdit ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <CustomerForm
                            customer={{
                              id: customer.id,
                              name: customer.name,
                              phone: customer.phone,
                              alt_phone: customer.alt_phone,
                              email: customer.email,
                              governorate: customer.governorate,
                              city: customer.city,
                              address: customer.address,
                              preferred_language: customer.preferred_language,
                              notes: customer.notes,
                            }}
                          />
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
