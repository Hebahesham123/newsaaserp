import Link from 'next/link';
import { requirePermission } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Breadcrumb, Card, EmptyState, Notice, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { Money, ProductStatusBadge } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { searchTerm } from '@/lib/filters';

/**
 * §3.14 the unmapped-products queue.
 *
 * Reads the `unmapped_products` view rather than recomputing the condition, so
 * this screen and the §3.14 report can never disagree about what "unmapped"
 * means. Rule 13 makes this a blocking queue: inventory cannot sync for
 * anything listed here.
 */
export default async function UnmappedProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePermission('products.view');
  const { q } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase.from('unmapped_products').select('*').order('sku').limit(200);

  const term = searchTerm(q);
  if (term) query = query.or(`sku.ilike.%${term}%,name_en.ilike.%${term}%,name_ar.ilike.%${term}%`);

  const { data: products } = await query;

  return (
    <>
      <PageHeader
        breadcrumb={<Breadcrumb items={[{ label: t.products.title, href: '/products' }, { label: t.products.unmapped }]} />}
        title={t.products.unmapped}
        subtitle={t.products.unmappedSubtitle}
      />

      <Toolbar placeholder={`${t.products.sku} / ${t.common.name}`} />

      {products && products.length > 0 ? (
        <div className="mb-4">
          <Notice tone="warning">
            {products.length} {t.common.results} — inventory synchronization is blocked for these until a
            channel mapping exists (§3.13 rule 13).
          </Notice>
        </div>
      ) : null}

      <Card>
        {!products || products.length === 0 ? (
          <EmptyState
            title={t.common.noResults}
            hint="Every product has at least one live channel mapping."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.products.sku}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.common.status}</Th>
                <Th className="text-end">{t.products.basePrice}</Th>
                <Th className="text-end">{t.products.variantCount}</Th>
                <Th className="text-end">{t.products.mappingCount}</Th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <Tr key={product.id}>
                  <Td className="tnum font-medium" dir="ltr">
                    {product.sku}
                    {product.barcode ? (
                      <span className="block text-xs text-ink-subtle">{product.barcode}</span>
                    ) : null}
                  </Td>
                  <Td>
                    <Link href={`/products/${product.id}`} className="text-brand hover:underline">
                      {locale === 'ar' ? product.name_ar : product.name_en}
                    </Link>
                  </Td>
                  <Td>
                    <ProductStatusBadge status={product.status} />
                  </Td>
                  <Td className="text-end">
                    {product.base_price == null ? (
                      <Badge tone="warning">{t.products.noPrice}</Badge>
                    ) : (
                      <Money amount={product.base_price} />
                    )}
                  </Td>
                  <Td className="tnum text-end text-ink-muted">{product.variant_count}</Td>
                  <Td className="tnum text-end text-ink-muted">{product.mapping_count}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
