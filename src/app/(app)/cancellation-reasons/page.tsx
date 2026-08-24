import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, Notice, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { ReasonForm, type Option } from '../orders/settings-forms';

/**
 * §4.11 — the spec requires these to be "fully configurable", so they are rows
 * rather than an enum and every company starts with the spec's examples as a
 * seed it is free to change.
 */
export default async function CancellationReasonsPage() {
  const session = await requirePermission('orders.view');
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  const [{ data: reasons }, companiesResult] = await Promise.all([
    supabase.from('cancellation_reasons').select('*').order('sort_order'),
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

  const canManage = can(session, 'orders.reasons.manage');

  return (
    <>
      <PageHeader
        title={t.cancellationReasons.title}
        subtitle={t.cancellationReasons.subtitle}
        actions={canManage ? <ReasonForm companies={companyOptions} /> : null}
      />

      <div className="mb-4">
        <Notice tone="info">
          Every cancellation must record one of these (§4.15 rule 8). Deactivate a reason instead of
          deleting it so past cancellations keep their explanation.
        </Notice>
      </div>

      <Card>
        {!reasons || reasons.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.cancellationReasons.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.cancellationReasons.customerFault}</Th>
                <Th>{t.cancellationReasons.requiresNote}</Th>
                <Th className="text-end">{t.catalog.sortOrder}</Th>
                <Th>{t.common.status}</Th>
                {canManage ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {reasons.map((reason) => (
                <Tr key={reason.id}>
                  <Td className="tnum font-medium" dir="ltr">
                    {reason.code}
                  </Td>
                  <Td>{locale === 'ar' ? reason.name_ar : reason.name_en}</Td>
                  <Td className="text-ink-muted">
                    {reason.is_customer_fault ? t.common.yes : t.common.no}
                  </Td>
                  <Td className="text-ink-muted">
                    {reason.requires_note ? t.common.yes : t.common.no}
                  </Td>
                  <Td className="tnum text-end text-ink-muted">{reason.sort_order}</Td>
                  <Td>
                    <Badge tone={reason.is_active ? 'success' : 'neutral'}>
                      {reason.is_active ? t.common.active : t.common.inactive}
                    </Badge>
                  </Td>
                  {canManage ? (
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <ReasonForm
                          reason={{
                            id: reason.id,
                            code: reason.code,
                            name_en: reason.name_en,
                            name_ar: reason.name_ar,
                            is_customer_fault: reason.is_customer_fault,
                            requires_note: reason.requires_note,
                            sort_order: reason.sort_order,
                            is_active: reason.is_active,
                          }}
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
