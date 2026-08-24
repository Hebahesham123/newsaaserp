import Link from 'next/link';
import { requirePermission } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { DateTime, Money } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { pickFilter, searchTerm } from '@/lib/filters';

const KINDS = ['price', 'cost'] as const;

/**
 * §3.13 rule 15 — every price and cost change, with who made it.
 *
 * The rows are written by database triggers, not by application code, so this
 * screen is a pure read: there is no path that changes a price without landing
 * here.
 */
export default async function PriceHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string }>;
}) {
  await requirePermission('products.price.history');
  const { q, kind } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('price_history')
    .select('*, products(id, sku, name_en, name_ar), app_users(full_name)')
    .order('changed_at', { ascending: false })
    .limit(200);

  const kindFilter = pickFilter(kind, KINDS);
  if (kindFilter) query = query.eq('kind', kindFilter);

  const term = searchTerm(q);
  if (term) query = query.ilike('products.sku', `%${term}%`);

  const { data: entries } = await query;

  return (
    <>
      <PageHeader title={t.products.priceHistory} subtitle={t.products.priceHistorySubtitle} />

      <Toolbar
        placeholder={t.products.sku}
        filters={[
          {
            name: 'kind',
            label: t.products.kind,
            options: [
              { value: 'price', label: t.products.price },
              { value: 'cost', label: t.products.cost },
            ],
          },
        ]}
      />

      <Card>
        {!entries || entries.length === 0 ? (
          <EmptyState title={t.common.noResults} hint={t.products.priceHistorySubtitle} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.audit.when}</Th>
                <Th>{t.products.title}</Th>
                <Th>{t.products.kind}</Th>
                <Th>{t.products.scope}</Th>
                <Th className="text-end">{t.products.oldAmount}</Th>
                <Th className="text-end">{t.products.newAmount}</Th>
                <Th>{t.products.changedBy}</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const product = entry.products as unknown as {
                  id: string;
                  sku: string;
                  name_en: string;
                  name_ar: string;
                } | null;
                const actor = entry.app_users as unknown as { full_name: string } | null;

                const label =
                  entry.kind === 'price'
                    ? (entry.price_type
                        ? t.priceType[entry.price_type as keyof typeof t.priceType]
                        : t.products.price)
                    : (entry.component
                        ? t.costComponent[entry.component as keyof typeof t.costComponent]
                        : t.products.cost);

                return (
                  <Tr key={entry.id}>
                    <Td className="text-ink-muted">
                      <DateTime value={entry.changed_at} />
                    </Td>
                    <Td>
                      {product ? (
                        <Link href={`/products/${product.id}`} className="text-brand hover:underline">
                          <span className="tnum" dir="ltr">{product.sku}</span>
                          <span className="block text-xs text-ink-subtle">
                            {locale === 'ar' ? product.name_ar : product.name_en}
                          </span>
                        </Link>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td>
                      <Badge tone={entry.kind === 'price' ? 'brand' : 'neutral'}>{label ?? entry.kind}</Badge>
                    </Td>
                    <Td className="text-xs text-ink-muted">{entry.scope ?? '—'}</Td>
                    <Td className="text-end text-ink-muted">
                      <Money amount={entry.old_amount} currency={entry.currency} />
                    </Td>
                    <Td className="text-end">
                      <Money amount={entry.new_amount} currency={entry.currency} />
                    </Td>
                    <Td className="text-ink-muted">
                      {actor?.full_name ?? '—'}
                      {entry.change_reason ? (
                        <span className="block text-xs text-ink-subtle">{entry.change_reason}</span>
                      ) : null}
                    </Td>
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
