import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { DateOnly } from '@/components/status-badge';
import { ActionButton } from '@/components/form/action-button';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter, searchTerm } from '@/lib/filters';
import { BlacklistForm, type Option } from '../orders/settings-forms';
import { setBlacklistActive } from '../orders/settings-actions';

const SCOPES = ['phone', 'address', 'email'] as const;

export default async function BlacklistPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; scope?: string; inactive?: string }>;
}) {
  const session = await requirePermission('orders.blacklist.view');
  const { q, scope, inactive } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('blacklist_entries')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300);

  const term = searchTerm(q);
  if (term) query = query.or(`value.ilike.%${term}%,reason.ilike.%${term}%`);

  const scopeFilter = pickFilter(scope, SCOPES);
  if (scopeFilter) query = query.eq('scope', scopeFilter);

  query = query.eq('is_active', !inactive);

  const [{ data: entries }, companiesResult] = await Promise.all([
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

  const canManage = can(session, 'orders.blacklist.manage');

  const scopeLabel = (value: string) =>
    value === 'phone' ? t.orders.phone : value === 'address' ? t.orders.address : t.common.email;

  return (
    <>
      <PageHeader
        title={t.blacklist.title}
        subtitle={t.blacklist.subtitle}
        actions={canManage ? <BlacklistForm companies={companyOptions} /> : null}
      />

      <Toolbar
        placeholder={t.blacklist.value}
        filters={[
          {
            name: 'scope',
            label: t.blacklist.scope,
            options: SCOPES.map((value) => ({ value, label: scopeLabel(value) })),
          },
          { name: 'inactive', label: t.common.inactive, options: [{ value: '1', label: t.common.yes }] },
        ]}
      />

      <Card>
        {!entries || entries.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.blacklist.subtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.blacklist.scope}</Th>
                <Th>{t.blacklist.value}</Th>
                <Th>{t.blacklist.reason}</Th>
                <Th>{t.blacklist.expiresAt}</Th>
                <Th>{t.common.status}</Th>
                {canManage ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <Tr key={entry.id}>
                  <Td>
                    <Badge tone="neutral">{scopeLabel(entry.scope)}</Badge>
                  </Td>
                  <Td className="tnum font-medium" dir="ltr">
                    {entry.value}
                  </Td>
                  <Td className="text-ink-muted">{entry.reason}</Td>
                  <Td className="text-ink-muted">
                    {entry.expires_at ? <DateOnly value={entry.expires_at} /> : t.blacklist.permanent}
                  </Td>
                  <Td>
                    <Badge tone={entry.is_active ? 'danger' : 'neutral'}>
                      {entry.is_active ? t.common.active : t.common.inactive}
                    </Badge>
                  </Td>
                  {canManage ? (
                    <Td>
                      <div className="flex items-center justify-end gap-1">
                        <BlacklistForm
                          entry={{
                            id: entry.id,
                            scope: entry.scope,
                            value: entry.value,
                            reason: entry.reason,
                            expires_at: entry.expires_at,
                            is_active: entry.is_active,
                          }}
                        />
                        <ActionButton
                          action={setBlacklistActive}
                          fields={entry.is_active ? { id: entry.id } : { id: entry.id, activate: '1' }}
                          label={entry.is_active ? t.common.remove : t.common.unarchive}
                          icon={entry.is_active ? 'reject' : 'restore'}
                          confirm={entry.is_active ? t.common.confirm : undefined}
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
