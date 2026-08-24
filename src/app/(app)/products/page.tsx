import Link from 'next/link';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from '@/components/ui';
import { Money, ProductStatusBadge, ProductTypeLabel } from '@/components/status-badge';
import { Toolbar } from '@/components/form/toolbar';
import { ActionButton } from '@/components/form/action-button';
import { pickFilter, searchTerm } from '@/lib/filters';
import { ProductForm, type ProductDraft } from './product-form';
import { StatusSelect } from './status-select';
import { archiveProduct, approveProduct } from './actions';
import type { ProductRow } from '@/lib/supabase/database.types';

/**
 * The list query embeds related rows, so the product cannot be handed to the
 * form as-is — the embedded keys are not columns and would be posted back.
 */
function toDraft(product: ProductRow): ProductDraft {
  return {
    id: product.id,
    merchant_id: product.merchant_id,
    sku: product.sku,
    barcode: product.barcode,
    name_en: product.name_en,
    name_ar: product.name_ar,
    short_description: product.short_description,
    description: product.description,
    product_type: product.product_type,
    status: product.status,
    brand_id: product.brand_id,
    category_id: product.category_id,
    supplier_id: product.supplier_id,
    uom_id: product.uom_id,
    weight_grams: product.weight_grams,
    length_cm: product.length_cm,
    width_cm: product.width_cm,
    height_cm: product.height_cm,
    country_of_origin: product.country_of_origin,
    base_price: product.base_price,
    base_cost: product.base_cost,
    currency: product.currency,
    tax_rate: product.tax_rate,
    tax_included: product.tax_included,
    min_sale_quantity: product.min_sale_quantity,
    max_sale_quantity: product.max_sale_quantity,
    is_sellable: product.is_sellable,
    is_stock_item: product.is_stock_item,
    is_batch_tracked: product.is_batch_tracked,
    is_expiry_tracked: product.is_expiry_tracked,
    is_serial_tracked: product.is_serial_tracked,
    shelf_life_days: product.shelf_life_days,
    tags: product.tags,
    is_seasonal: product.is_seasonal,
    internal_notes: product.internal_notes,
  };
}

const PRODUCT_STATUSES = [
  'draft', 'under_review', 'active', 'inactive', 'unavailable', 'out_of_stock',
  'temporarily_suspended', 'discontinued', 'archived', 'sync_error', 'unmapped',
] as const;

const PRODUCT_TYPES = [
  'simple', 'variant', 'bundle', 'kit', 'composite', 'digital', 'service',
  'marketplace', 'made_to_order', 'batch_controlled', 'serial_controlled',
] as const;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string; archived?: string }>;
}) {
  const session = await requirePermission('products.view');
  const { q, status, type, archived } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  let query = supabase
    .from('products')
    .select('*, merchants(name), product_variants(count), product_channel_mappings(count)')
    .order('created_at', { ascending: false })
    .limit(200);

  const term = searchTerm(q);
  if (term) {
    query = query.or(`sku.ilike.%${term}%,name_en.ilike.%${term}%,name_ar.ilike.%${term}%,barcode.ilike.%${term}%`);
  }

  const statusFilter = pickFilter(status, PRODUCT_STATUSES);
  if (statusFilter) query = query.eq('status', statusFilter);

  const typeFilter = pickFilter(type, PRODUCT_TYPES);
  if (typeFilter) query = query.eq('product_type', typeFilter);

  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);

  // Reference data for the create form. Each is company-scoped by RLS, so the
  // lists a user sees are already the ones they may write against.
  const [{ data: products }, { data: merchants }, { data: brands }, { data: categories }, { data: suppliers }, { data: units }] =
    await Promise.all([
      query,
      supabase.from('merchants').select('id, name').is('archived_at', null).order('name'),
      supabase.from('brands').select('id, name_en, name_ar').is('archived_at', null).order('name_en'),
      supabase.from('categories').select('id, name_en, name_ar').is('archived_at', null).order('sort_order'),
      supabase.from('suppliers').select('id, name').is('archived_at', null).order('name'),
      supabase.from('units_of_measure').select('id, name_en, name_ar').order('name_en'),
    ]);

  const localised = (rows: { id: string; name_en: string; name_ar: string }[] | null) =>
    (rows ?? []).map((row) => ({ id: row.id, name: locale === 'ar' ? row.name_ar : row.name_en }));

  const merchantOptions = (merchants ?? []).map((m) => ({ id: m.id, name: m.name }));
  const referenceData = {
    merchants: merchantOptions,
    brands: localised(brands),
    categories: localised(categories),
    suppliers: (suppliers ?? []).map((s) => ({ id: s.id, name: s.name })),
    units: localised(units),
  };

  const canCreate = can(session, 'products.create');
  const canEdit = can(session, 'products.edit');
  const canArchive = can(session, 'products.archive');
  const canStatus = can(session, 'products.status');
  const canApprove = can(session, 'products.approve');
  const canViewCost = can(session, 'products.cost.view');
  const canEditIdentifiers = can(session, 'products.identifiers.edit');

  return (
    <>
      <PageHeader
        title={t.products.title}
        subtitle={t.products.subtitle}
        actions={
          <>
            <ButtonLink href="/products/unmapped" variant="secondary">
              {t.products.unmapped}
            </ButtonLink>
            {canCreate ? <ProductForm {...referenceData} canEditIdentifiers={canEditIdentifiers} /> : null}
          </>
        }
      />

      <Toolbar
        placeholder={`${t.products.sku} / ${t.common.name}`}
        filters={[
          {
            name: 'status',
            label: t.common.status,
            options: PRODUCT_STATUSES.map((value) => ({ value, label: t.productStatus[value] })),
          },
          {
            name: 'type',
            label: t.products.productType,
            options: PRODUCT_TYPES.map((value) => ({ value, label: t.productType[value] })),
          },
          { name: 'archived', label: t.common.archived, options: [{ value: '1', label: t.common.yes }] },
        ]}
      />

      <Card>
        {!products || products.length === 0 ? (
          <EmptyState
            title={t.common.noResults}
            hint="Create a product, or connect a store and let the channel sync bring its catalog in."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t.products.sku}</Th>
                <Th>{t.common.name}</Th>
                <Th>{t.stores.merchant}</Th>
                <Th>{t.products.productType}</Th>
                <Th>{t.common.status}</Th>
                <Th className="text-end">{t.products.basePrice}</Th>
                {canViewCost ? <Th className="text-end">{t.products.baseCost}</Th> : null}
                <Th className="text-end">{t.products.variantCount}</Th>
                <Th className="text-end">{t.products.mappingCount}</Th>
                {canEdit || canArchive || canApprove ? <Th className="text-end">{t.common.actions}</Th> : null}
              </tr>
            </thead>
            <tbody>
              {products.map((product) => {
                const merchant = product.merchants as unknown as { name: string } | null;
                const variantCount =
                  (product.product_variants as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
                const mappingCount =
                  (product.product_channel_mappings as unknown as { count: number }[] | null)?.[0]?.count ?? 0;

                return (
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
                      {product.approved_at ? (
                        <Badge tone="success" className="ms-2 text-[10px]">
                          {t.products.approved}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td className="text-ink-muted">{merchant?.name ?? '—'}</Td>
                    <Td className="text-ink-muted">
                      <ProductTypeLabel type={product.product_type} />
                    </Td>
                    <Td>
                      {canStatus && !product.archived_at ? (
                        <StatusSelect id={product.id} status={product.status} />
                      ) : (
                        <ProductStatusBadge status={product.status} />
                      )}
                    </Td>
                    <Td className="text-end">
                      <Money amount={product.base_price} currency={product.currency} />
                    </Td>
                    {canViewCost ? (
                      <Td className="text-end text-ink-muted">
                        <Money amount={product.base_cost} currency={product.currency} />
                      </Td>
                    ) : null}
                    <Td className="tnum text-end text-ink-muted">{variantCount}</Td>
                    <Td className="tnum text-end">
                      {mappingCount === 0 ? (
                        <Badge tone="warning">{t.mappingStatus.unmapped}</Badge>
                      ) : (
                        <span className="text-ink-muted">{mappingCount}</span>
                      )}
                    </Td>
                    {canEdit || canArchive || canApprove ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          {canApprove && !product.approved_at ? (
                            <ActionButton
                              action={approveProduct}
                              fields={{ id: product.id }}
                              label={t.products.approve}
                              icon="approve"
                              iconOnly
                            />
                          ) : null}
                          {canEdit ? (
                            <ProductForm
                              product={toDraft(product)}
                              {...referenceData}
                              canEditIdentifiers={canEditIdentifiers}
                            />
                          ) : null}
                          {canArchive ? (
                            <ActionButton
                              action={archiveProduct}
                              fields={
                                product.archived_at
                                  ? { id: product.id, restore: '1' }
                                  : { id: product.id }
                              }
                              label={product.archived_at ? t.common.unarchive : t.common.archive}
                              icon={product.archived_at ? 'restore' : 'archive'}
                              confirm={product.archived_at ? undefined : t.common.archiveConfirm}
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

      {products && products.length > 0 ? (
        <p className="mt-3 text-xs text-ink-subtle">
          {t.common.showing} {products.length} {t.common.results}
        </p>
      ) : null}
    </>
  );
}
