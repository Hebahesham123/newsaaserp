import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, Notice, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { TemplateForm, type Option } from '../orders/settings-forms';

/** §4.9 bilingual WhatsApp templates with placeholders filled from the order. */
export default async function MessageTemplatesPage() {
  const session = await requirePermission('orders.view');
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  const [{ data: templates }, companiesResult] = await Promise.all([
    supabase.from('message_templates').select('*').order('sort_order'),
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

  const canManage = can(session, 'orders.templates.manage');

  return (
    <>
      <PageHeader
        title={t.messageTemplates.title}
        subtitle={t.messageTemplates.subtitle}
        actions={canManage ? <TemplateForm companies={companyOptions} /> : null}
      />

      <div className="mb-4">
        <Notice tone="info">
          No WhatsApp provider is connected yet. Messages sent from an order are recorded and queued;
          connecting a provider later delivers the queue without changing these templates.
        </Notice>
      </div>

      <Card>
        {!templates || templates.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.messageTemplates.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.common.code}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.orders.channel}</Th>
                <Th>{t.messageTemplates.bodyAr}</Th>
                <Th>{t.messageTemplates.variables}</Th>
                <Th>{t.common.status}</Th>
                {canManage ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <Tr key={template.id}>
                  <Td className="tnum font-medium" dir="ltr">
                    {template.code}
                  </Td>
                  <Td>{template.name}</Td>
                  <Td className="text-ink-muted">{template.channel}</Td>
                  <Td className="max-w-sm text-xs text-ink-muted" dir="rtl">
                    {template.body_ar}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {template.variables.length === 0 ? (
                        <span className="text-ink-subtle">—</span>
                      ) : (
                        template.variables.map((variable) => (
                          <Badge key={variable} className="text-[10px]" dir="ltr">
                            {`{${variable}}`}
                          </Badge>
                        ))
                      )}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={template.is_active ? 'success' : 'neutral'}>
                      {template.is_active ? t.common.active : t.common.inactive}
                    </Badge>
                  </Td>
                  {canManage ? (
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <TemplateForm
                          template={{
                            id: template.id,
                            code: template.code,
                            name: template.name,
                            channel: template.channel,
                            body_ar: template.body_ar,
                            body_en: template.body_en,
                            variables: template.variables,
                            sort_order: template.sort_order,
                            is_active: template.is_active,
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
