import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { Toolbar } from '@/components/form/toolbar';
import { ActionButton } from '@/components/form/action-button';
import { searchTerm } from '@/lib/filters';
import { SupplierForm, type Option } from './supplier-form';
import { archiveSupplier } from '../catalog/actions';

export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string }>;
}) {
  const session = await requirePermission('suppliers.view');
  const { q, archived } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase.from('suppliers').select('*').order('name').limit(200);

  const term = searchTerm(q);
  if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%,contact_person.ilike.%${term}%`);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);

  const [{ data: suppliers }, { data: merchants }, companiesResult] = await Promise.all([
    query,
    supabase.from('merchants').select('id, name').is('archived_at', null).order('name'),
    session.profile.company_id
      ? Promise.resolve({ data: null })
      : supabase.from('companies').select('id, name_en, name_ar').is('archived_at', null).order('name_en'),
  ]);

  const merchantOptions: Option[] = (merchants ?? []).map((m) => ({ id: m.id, name: m.name }));
  const companyOptions: Option[] | undefined = session.profile.company_id
    ? undefined
    : (companiesResult.data ?? []).map((c) => ({
        id: c.id,
        name: locale === 'ar' ? c.name_ar : c.name_en,
      }));

  const canManage = can(session, 'suppliers.manage');

  const merchantName = (id: string | null) =>
    id ? (merchantOptions.find((option) => option.id === id)?.name ?? '—') : t.warehouses.shared;

  return (
    <>
      <PageHeader
        title={t.suppliers.title}
        subtitle={t.suppliers.subtitle}
        actions={
          canManage ? <SupplierForm merchants={merchantOptions} companies={companyOptions} /> : null
        }
      />

      <Toolbar
        placeholder={t.suppliers.title}
        filters={[
          { name: 'archived', label: t.common.archived, options: [{ value: '1', label: t.common.yes }] },
        ]}
      />

      <Card>
        {!suppliers || suppliers.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.suppliers.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.stores.merchant}</Th>
                <Th>{t.merchants.contactPerson}</Th>
                <Th>{t.common.country}</Th>
                <Th className="text-end">{t.suppliers.leadTime}</Th>
                <Th>{t.suppliers.paymentTerms}</Th>
                <Th>{t.common.status}</Th>
                {canManage ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <Tr key={supplier.id}>
                  <Td className="tnum font-medium" dir="ltr">{supplier.code}</Td>
                  <Td>{supplier.name}</Td>
                  <Td className="text-ink-muted">{merchantName(supplier.merchant_id)}</Td>
                  <Td className="text-ink-muted">
                    {supplier.contact_person ?? '—'}
                    {supplier.email ? (
                      <span className="block text-xs text-ink-subtle" dir="ltr">
                        {supplier.email}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="text-ink-muted">{supplier.country ?? '—'}</Td>
                  <Td className="tnum text-end text-ink-muted">{supplier.lead_time_days ?? '—'}</Td>
                  <Td className="text-ink-muted">{supplier.payment_terms ?? '—'}</Td>
                  <Td>
                    <Badge tone={supplier.is_active && !supplier.archived_at ? 'success' : 'neutral'}>
                      {supplier.archived_at
                        ? t.common.archived
                        : supplier.is_active
                          ? t.common.active
                          : t.common.inactive}
                    </Badge>
                  </Td>
                  {canManage ? (
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <SupplierForm
                          supplier={{
                            id: supplier.id,
                            code: supplier.code,
                            name: supplier.name,
                            merchant_id: supplier.merchant_id,
                            contact_person: supplier.contact_person,
                            email: supplier.email,
                            phone: supplier.phone,
                            country: supplier.country,
                            address: supplier.address,
                            payment_terms: supplier.payment_terms,
                            lead_time_days: supplier.lead_time_days,
                            notes: supplier.notes,
                            is_active: supplier.is_active,
                          }}
                          merchants={merchantOptions}
                        />
                        <ActionButton
                          action={archiveSupplier}
                          fields={
                            supplier.archived_at
                              ? { id: supplier.id, restore: '1' }
                              : { id: supplier.id }
                          }
                          label={supplier.archived_at ? t.common.unarchive : t.common.archive}
                          icon={supplier.archived_at ? 'restore' : 'archive'}
                          confirm={supplier.archived_at ? undefined : t.common.archiveConfirm}
                          iconOnly
                        />
                      </div>
                    </Td>
                  ) : null}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
