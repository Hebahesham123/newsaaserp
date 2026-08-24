import { notFound } from 'next/navigation';
import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  Badge,
  Breadcrumb,
  Card,
  CardBody,
  CardHeaderRow,
  Detail,
  DetailList,
  EmptyState,
  Notice,
  PageHeader,
  Table,
  Td,
  Th,
  Tr,
} from '@/components/ui';
import {
  DateOnly,
  DateTime,
  MappingStatusBadge,
  Money,
  ProductStatusBadge,
  ProductTypeLabel,
} from '@/components/status-badge';
import { ActionButton } from '@/components/form/action-button';
import {
  CollectionsForm,
  ComponentForm,
  CostForm,
  MappingForm,
  PriceForm,
  VariantForm,
  type Option,
} from './forms';
import {
  archiveVariant,
  deleteCost,
  deleteMapping,
  deletePrice,
  removeBundleComponent,
} from '../actions';

const BUNDLE_TYPES = ['bundle', 'kit', 'composite'];

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission('products.view');
  const { id } = await params;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  const { data: product } = await supabase
    .from('products')
    .select(
      '*, merchants(name), brands(name_en, name_ar), categories(name_en, name_ar), suppliers(name), units_of_measure(name_en, name_ar)',
    )
    .eq('id', id)
    .maybeSingle();

  if (!product) notFound();

  const canViewCost = can(session, 'products.cost.view');
  const canEditCost = can(session, 'products.cost.edit');
  const canEditPrice = can(session, 'products.price.edit');
  const canEdit = can(session, 'products.edit');
  const canMap = can(session, 'products.map');
  const canBundle = can(session, 'products.bundles.manage');
  const canCatalog = can(session, 'catalog.manage');
  const canPriceHistory = can(session, 'products.price.history');

  const isBundle = BUNDLE_TYPES.includes(product.product_type);

  const [
    { data: variants },
    { data: prices },
    costsResult,
    { data: mappings },
    { data: stores },
    { data: collections },
    { data: memberships },
    { data: attributes },
    componentsResult,
    historyResult,
  ] = await Promise.all([
    supabase.from('product_variants').select('*').eq('product_id', id).order('position'),
    supabase.from('product_prices').select('*, stores(name)').eq('product_id', id).order('priority', { ascending: false }),
    canViewCost
      ? supabase.from('product_costs').select('*').eq('product_id', id).order('component')
      : Promise.resolve({ data: null }),
    supabase.from('product_channel_mappings').select('*, stores(name)').eq('product_id', id),
    supabase.from('stores').select('id, name').is('archived_at', null).order('name'),
    supabase.from('collections').select('id, name_en, name_ar').order('name_en'),
    supabase.from('product_collections').select('collection_id').eq('product_id', id),
    // §3.6 the named axes a variant may be built from.
    supabase.from('product_attributes').select('code').eq('is_variant_axis', true).order('sort_order'),
    isBundle
      ? supabase
          .from('bundle_components')
          .select('*, product_variants(id, sku, name, cost, price)')
          .eq('bundle_product_id', id)
          .order('position')
      : Promise.resolve({ data: null }),
    canPriceHistory
      ? supabase
          .from('price_history')
          .select('*')
          .eq('product_id', id)
          .order('changed_at', { ascending: false })
          .limit(25)
      : Promise.resolve({ data: null }),
  ]);

  const costs = costsResult.data;
  const components = componentsResult.data;
  const history = historyResult.data;

  const merchant = product.merchants as unknown as { name: string } | null;
  const brand = product.brands as unknown as { name_en: string; name_ar: string } | null;
  const category = product.categories as unknown as { name_en: string; name_ar: string } | null;
  const supplier = product.suppliers as unknown as { name: string } | null;
  const uom = product.units_of_measure as unknown as { name_en: string; name_ar: string } | null;

  const pick = (row: { name_en: string; name_ar: string } | null) =>
    row ? (locale === 'ar' ? row.name_ar : row.name_en) : null;

  const variantOptions: Option[] = (variants ?? []).map((variant) => ({
    id: variant.id,
    name: variant.name ? `${variant.sku} — ${variant.name}` : variant.sku,
  }));
  const storeOptions: Option[] = (stores ?? []).map((store) => ({ id: store.id, name: store.name }));
  const collectionOptions: Option[] = (collections ?? []).map((collection) => ({
    id: collection.id,
    name: locale === 'ar' ? collection.name_ar : collection.name_en,
  }));
  const selectedCollections = (memberships ?? []).map((row) => row.collection_id);
  const axisCodes = (attributes ?? []).map((attribute) => attribute.code);

  // §3.9 a bundle draws on other sellable variants of the same merchant.
  const { data: candidateVariants } = isBundle
    ? await supabase
        .from('product_variants')
        .select('id, sku, name')
        .eq('merchant_id', product.merchant_id)
        .neq('product_id', id)
        .is('archived_at', null)
        .order('sku')
        .limit(300)
    : { data: null };

  const componentOptions: Option[] = (candidateVariants ?? []).map((variant) => ({
    id: variant.id,
    name: variant.name ? `${variant.sku} — ${variant.name}` : variant.sku,
  }));

  const title = locale === 'ar' ? product.name_ar : product.name_en;
  const margin =
    product.base_price != null && product.base_cost != null && product.base_price > 0
      ? ((product.base_price - product.base_cost) / product.base_price) * 100
      : null;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Breadcrumb items={[{ label: t.products.title, href: '/products' }, { label: product.sku }]} />
        }
        title={title}
        subtitle={`${product.sku}${product.barcode ? ` · ${product.barcode}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ProductStatusBadge status={product.status} />
            {product.approved_at ? <Badge tone="success">{t.products.approved}</Badge> : (
              <Badge tone="neutral">{t.products.notApproved}</Badge>
            )}
          </div>
        }
      />

      {product.archived_at ? (
        <div className="mb-4">
          <Notice tone="warning">{t.common.archived}</Notice>
        </div>
      ) : null}

      {product.base_price == null ? (
        <div className="mb-4">
          <Notice tone="warning">{t.products.publishBlocked}</Notice>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ---------------------------------------------------------------- */}
        {/* Master data                                                      */}
        {/* ---------------------------------------------------------------- */}
        <Card className="lg:col-span-1">
          <CardHeaderRow title={t.common.details} />
          <CardBody>
            <DetailList className="sm:grid-cols-1">
              <Detail label={t.stores.merchant}>{merchant?.name}</Detail>
              <Detail label={t.products.productType}>
                <ProductTypeLabel type={product.product_type} />
              </Detail>
              <Detail label={t.products.brand}>{pick(brand)}</Detail>
              <Detail label={t.products.category}>{pick(category)}</Detail>
              <Detail label={t.products.supplier}>{supplier?.name}</Detail>
              <Detail label={t.products.uom}>{pick(uom)}</Detail>
              <Detail label={t.products.basePrice}>
                <Money amount={product.base_price} currency={product.currency} />
              </Detail>
              {canViewCost ? (
                <Detail label={t.products.baseCost}>
                  <Money amount={product.base_cost} currency={product.currency} />
                </Detail>
              ) : null}
              {canViewCost && margin != null ? (
                <Detail label={t.products.margin}>
                  <span className={margin < 0 ? 'text-danger' : 'text-success'}>{margin.toFixed(1)}%</span>
                </Detail>
              ) : null}
              <Detail label={t.products.taxRate}>
                {product.tax_rate != null ? `${product.tax_rate}%` : null}
              </Detail>
              <Detail label={t.products.weight}>{product.weight_grams}</Detail>
              <Detail label={t.products.dimensions}>
                {product.length_cm && product.width_cm && product.height_cm
                  ? `${product.length_cm} × ${product.width_cm} × ${product.height_cm}`
                  : null}
              </Detail>
              <Detail label={t.products.origin}>{product.country_of_origin}</Detail>
              <Detail label={t.products.tags}>
                {product.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {product.tags.map((tag) => (
                      <Badge key={tag}>{tag}</Badge>
                    ))}
                  </div>
                ) : null}
              </Detail>
              <Detail label={t.products.approved}>
                <DateTime value={product.approved_at} />
              </Detail>
              <Detail label={t.common.createdAt}>
                <DateTime value={product.created_at} />
              </Detail>
            </DetailList>
          </CardBody>
        </Card>

        <div className="grid gap-4 lg:col-span-2">
          {/* -------------------------------------------------------------- */}
          {/* Variants — §3.4                                                */}
          {/* -------------------------------------------------------------- */}
          <Card>
            <CardHeaderRow title={t.products.variants} hint={t.products.variantsSubtitle}>
              {canEdit ? <VariantForm productId={id} axes={axisCodes} /> : null}
            </CardHeaderRow>
            {!variants || variants.length === 0 ? (
              <EmptyState title={t.common.noResults} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t.products.sku}</Th>
                    <Th>{t.products.options}</Th>
                    <Th className="text-end">{t.products.basePrice}</Th>
                    {canViewCost ? <Th className="text-end">{t.products.baseCost}</Th> : null}
                    <Th>{t.common.status}</Th>
                    {canEdit ? <Th className="text-end">{t.common.actions}</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {variants.map((variant) => {
                    const options = (variant.options ?? {}) as Record<string, string>;
                    return (
                      <Tr key={variant.id}>
                        <Td className="tnum font-medium" dir="ltr">
                          {variant.sku}
                          {variant.name ? (
                            <span className="block text-xs text-ink-subtle">{variant.name}</span>
                          ) : null}
                        </Td>
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(options).length === 0 ? (
                              <span className="text-ink-subtle">—</span>
                            ) : (
                              Object.entries(options).map(([key, value]) => (
                                <Badge key={key} tone="brand" className="text-[10px]">
                                  {key}: {value}
                                </Badge>
                              ))
                            )}
                          </div>
                        </Td>
                        <Td className="text-end">
                          <Money amount={variant.price} currency={product.currency} />
                        </Td>
                        {canViewCost ? (
                          <Td className="text-end text-ink-muted">
                            <Money amount={variant.cost} currency={product.currency} />
                          </Td>
                        ) : null}
                        <Td>
                          <div className="flex flex-wrap items-center gap-1">
                            {variant.is_default ? (
                              <Badge tone="info">{t.products.defaultVariant}</Badge>
                            ) : null}
                            <Badge tone={variant.is_active && !variant.archived_at ? 'success' : 'neutral'}>
                              {variant.archived_at
                                ? t.common.archived
                                : variant.is_active
                                  ? t.common.active
                                  : t.common.inactive}
                            </Badge>
                          </div>
                        </Td>
                        {canEdit ? (
                          <Td>
                            <div className="flex items-center justify-end gap-1">
                              <VariantForm
                                productId={id}
                                axes={axisCodes}
                                variant={{
                                  id: variant.id,
                                  sku: variant.sku,
                                  barcode: variant.barcode,
                                  name: variant.name,
                                  options,
                                  price: variant.price,
                                  cost: variant.cost,
                                  weight_grams: variant.weight_grams,
                                  image_url: variant.image_url,
                                  position: variant.position,
                                  is_active: variant.is_active,
                                }}
                              />
                              {variant.is_default ? null : (
                                <ActionButton
                                  action={archiveVariant}
                                  fields={
                                    variant.archived_at
                                      ? { id: variant.id, product_id: id, restore: '1' }
                                      : { id: variant.id, product_id: id }
                                  }
                                  label={variant.archived_at ? t.common.unarchive : t.common.archive}
                                  icon={variant.archived_at ? 'restore' : 'archive'}
                                  confirm={variant.archived_at ? undefined : t.common.archiveConfirm}
                                  iconOnly
                                />
                              )}
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

          {/* -------------------------------------------------------------- */}
          {/* Price matrix — §3.7                                            */}
          {/* -------------------------------------------------------------- */}
          <Card>
            <CardHeaderRow title={t.products.prices} hint={t.products.pricesSubtitle}>
              {canEditPrice ? (
                <PriceForm
                  productId={id}
                  currency={product.currency}
                  variants={variantOptions}
                  stores={storeOptions}
                />
              ) : null}
            </CardHeaderRow>
            {!prices || prices.length === 0 ? (
              <EmptyState title={t.products.noPrice} hint={t.products.pricesSubtitle} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t.products.priceType}</Th>
                    <Th className="text-end">{t.products.amount}</Th>
                    <Th>{t.products.scope}</Th>
                    <Th>{t.products.validFrom}</Th>
                    <Th>{t.common.status}</Th>
                    {canEditPrice ? <Th className="text-end">{t.common.actions}</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {prices.map((price) => {
                    const store = price.stores as unknown as { name: string } | null;
                    return (
                      <Tr key={price.id}>
                        <Td className="font-medium">
                          {t.priceType[price.price_type as keyof typeof t.priceType] ?? price.price_type}
                        </Td>
                        <Td className="text-end">
                          <Money amount={price.amount} currency={price.currency} />
                        </Td>
                        <Td className="text-xs text-ink-muted">
                          {[
                            store?.name,
                            price.country,
                            price.min_quantity ? `≥ ${price.min_quantity}` : null,
                            price.variant_id ? t.products.variants : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </Td>
                        <Td className="text-ink-muted">
                          <DateOnly value={price.valid_from} />
                        </Td>
                        <Td>
                          <Badge tone={price.is_active ? 'success' : 'neutral'}>
                            {price.is_active ? t.common.active : t.common.inactive}
                          </Badge>
                        </Td>
                        {canEditPrice ? (
                          <Td>
                            <div className="flex items-center justify-end gap-1">
                              <PriceForm
                                productId={id}
                                currency={product.currency}
                                variants={variantOptions}
                                stores={storeOptions}
                                price={{
                                  id: price.id,
                                  variant_id: price.variant_id,
                                  price_type: price.price_type,
                                  amount: price.amount,
                                  currency: price.currency,
                                  store_id: price.store_id,
                                  country: price.country,
                                  min_quantity: price.min_quantity,
                                  valid_from: price.valid_from,
                                  valid_to: price.valid_to,
                                  priority: price.priority,
                                  is_active: price.is_active,
                                  note: price.note,
                                }}
                              />
                              <ActionButton
                                action={deletePrice}
                                fields={{ id: price.id, product_id: id }}
                                label={t.common.remove}
                                icon="reject"
                                confirm={t.common.confirm}
                                iconOnly
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

          {/* -------------------------------------------------------------- */}
          {/* Cost components — §3.8, behind the sensitive cost permission    */}
          {/* -------------------------------------------------------------- */}
          {canViewCost ? (
            <Card>
              <CardHeaderRow title={t.products.costs} hint={t.products.costsSubtitle}>
                {canEditCost ? (
                  <CostForm productId={id} currency={product.currency} variants={variantOptions} />
                ) : null}
              </CardHeaderRow>
              {!costs || costs.length === 0 ? (
                <EmptyState title={t.products.noCost} hint={t.products.costsSubtitle} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t.products.costComponent}</Th>
                      <Th className="text-end">{t.products.amount}</Th>
                      <Th>{t.products.effectiveFrom}</Th>
                      {canEditCost ? <Th className="text-end">{t.common.actions}</Th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {costs.map((cost) => (
                      <Tr key={cost.id}>
                        <Td className="font-medium">
                          {t.costComponent[cost.component as keyof typeof t.costComponent] ?? cost.component}
                        </Td>
                        <Td className="text-end">
                          {cost.is_percentage ? (
                            <span className="tnum">{cost.amount}%</span>
                          ) : (
                            <Money amount={cost.amount} currency={cost.currency} />
                          )}
                        </Td>
                        <Td className="text-ink-muted">
                          <DateOnly value={cost.effective_from} />
                        </Td>
                        {canEditCost ? (
                          <Td>
                            <div className="flex items-center justify-end gap-1">
                              <CostForm
                                productId={id}
                                currency={product.currency}
                                variants={variantOptions}
                                cost={{
                                  id: cost.id,
                                  variant_id: cost.variant_id,
                                  component: cost.component,
                                  amount: cost.amount,
                                  currency: cost.currency,
                                  is_percentage: cost.is_percentage,
                                  effective_from: cost.effective_from,
                                  effective_to: cost.effective_to,
                                  note: cost.note,
                                }}
                              />
                              <ActionButton
                                action={deleteCost}
                                fields={{ id: cost.id, product_id: id }}
                                label={t.common.remove}
                                icon="reject"
                                confirm={t.common.confirm}
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
          ) : null}

          {/* -------------------------------------------------------------- */}
          {/* Channel mapping — §3.5                                         */}
          {/* -------------------------------------------------------------- */}
          <Card>
            <CardHeaderRow title={t.products.mappings} hint={t.products.mappingsSubtitle}>
              {canMap ? (
                <MappingForm productId={id} variants={variantOptions} stores={storeOptions} />
              ) : null}
            </CardHeaderRow>
            {!mappings || mappings.length === 0 ? (
              <EmptyState title={t.mappingStatus.unmapped} hint={t.products.unmappedSubtitle} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t.nav.stores}</Th>
                    <Th>{t.products.externalVariantId}</Th>
                    <Th>{t.products.masterSource}</Th>
                    <Th>{t.common.status}</Th>
                    {canMap ? <Th className="text-end">{t.common.actions}</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping) => {
                    const store = mapping.stores as unknown as { name: string } | null;
                    return (
                      <Tr key={mapping.id}>
                        <Td className="font-medium">{store?.name ?? '—'}</Td>
                        <Td className="tnum text-xs text-ink-muted" dir="ltr">
                          {mapping.external_variant_id ??
                            mapping.external_product_id ??
                            mapping.external_sku ??
                            mapping.asin ??
                            '—'}
                        </Td>
                        <Td className="text-ink-muted">{mapping.master_source}</Td>
                        <Td>
                          <MappingStatusBadge status={mapping.status} />
                          {mapping.last_error ? (
                            <span className="block text-xs text-danger">{mapping.last_error}</span>
                          ) : null}
                        </Td>
                        {canMap ? (
                          <Td>
                            <div className="flex items-center justify-end gap-1">
                              <MappingForm
                                productId={id}
                                variants={variantOptions}
                                stores={storeOptions}
                                mapping={{
                                  id: mapping.id,
                                  variant_id: mapping.variant_id,
                                  store_id: mapping.store_id,
                                  external_product_id: mapping.external_product_id,
                                  external_variant_id: mapping.external_variant_id,
                                  external_sku: mapping.external_sku,
                                  asin: mapping.asin,
                                  marketplace_fulfillment_sku: mapping.marketplace_fulfillment_sku,
                                  external_url: mapping.external_url,
                                  master_source: mapping.master_source,
                                  status: mapping.status,
                                }}
                              />
                              <ActionButton
                                action={deleteMapping}
                                fields={{ id: mapping.id, product_id: id }}
                                label={t.common.remove}
                                icon="reject"
                                confirm={t.common.confirm}
                                iconOnly
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

          {/* -------------------------------------------------------------- */}
          {/* Bundle composition — §3.9                                      */}
          {/* -------------------------------------------------------------- */}
          {isBundle ? (
            <Card>
              <CardHeaderRow title={t.products.bundle} hint={t.products.bundleSubtitle}>
                {canBundle ? (
                  <ComponentForm bundleProductId={id} candidates={componentOptions} />
                ) : null}
              </CardHeaderRow>
              {!components || components.length === 0 ? (
                <EmptyState title={t.common.noResults} hint={t.products.bundleSubtitle} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t.products.component}</Th>
                      <Th className="text-end">{t.products.quantity}</Th>
                      {canViewCost ? <Th className="text-end">{t.products.baseCost}</Th> : null}
                      <Th>{t.products.required}</Th>
                      {canBundle ? <Th className="text-end">{t.common.actions}</Th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {components.map((component) => {
                      const variant = component.product_variants as unknown as {
                        id: string;
                        sku: string;
                        name: string | null;
                        cost: number | null;
                      } | null;

                      return (
                        <Tr key={component.id}>
                          <Td className="tnum font-medium" dir="ltr">
                            {variant?.sku ?? '—'}
                            {variant?.name ? (
                              <span className="block text-xs text-ink-subtle">{variant.name}</span>
                            ) : null}
                          </Td>
                          <Td className="tnum text-end">{component.quantity}</Td>
                          {canViewCost ? (
                            <Td className="text-end text-ink-muted">
                              <Money
                                amount={variant?.cost != null ? variant.cost * component.quantity : null}
                                currency={product.currency}
                              />
                            </Td>
                          ) : null}
                          <Td>
                            <Badge tone={component.is_required ? 'info' : 'neutral'}>
                              {component.is_required ? t.common.yes : t.common.no}
                            </Badge>
                          </Td>
                          {canBundle ? (
                            <Td>
                              <div className="flex items-center justify-end gap-1">
                                <ActionButton
                                  action={removeBundleComponent}
                                  fields={{ id: component.id, product_id: id }}
                                  label={t.common.remove}
                                  icon="reject"
                                  confirm={t.common.confirm}
                                  iconOnly
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
          ) : null}

          {/* -------------------------------------------------------------- */}
          {/* Collections — §3.6                                             */}
          {/* -------------------------------------------------------------- */}
          <Card>
            <CardHeaderRow title={t.products.collections}>
              {canCatalog ? (
                <CollectionsForm
                  productId={id}
                  collections={collectionOptions}
                  selected={selectedCollections}
                />
              ) : null}
            </CardHeaderRow>
            <CardBody>
              {selectedCollections.length === 0 ? (
                <p className="text-sm text-ink-subtle">{t.common.none}</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {collectionOptions
                    .filter((collection) => selectedCollections.includes(collection.id))
                    .map((collection) => (
                      <Badge key={collection.id} tone="brand">
                        {collection.name}
                      </Badge>
                    ))}
                </div>
              )}
            </CardBody>
          </Card>

          {/* -------------------------------------------------------------- */}
          {/* Price history — §3.13 rule 15                                  */}
          {/* -------------------------------------------------------------- */}
          {canPriceHistory ? (
            <Card>
              <CardHeaderRow title={t.products.priceHistory} hint={t.products.priceHistorySubtitle} />
              {!history || history.length === 0 ? (
                <EmptyState title={t.common.noResults} />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t.audit.when}</Th>
                      <Th>{t.products.kind}</Th>
                      <Th className="text-end">{t.products.oldAmount}</Th>
                      <Th className="text-end">{t.products.newAmount}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((entry) => (
                      <Tr key={entry.id}>
                        <Td className="text-ink-muted">
                          <DateTime value={entry.changed_at} />
                        </Td>
                        <Td>
                          <Badge tone={entry.kind === 'price' ? 'brand' : 'neutral'}>
                            {entry.kind === 'price' ? t.products.price : t.products.cost}
                          </Badge>
                          <span className="ms-2 text-xs text-ink-subtle">{entry.scope}</span>
                        </Td>
                        <Td className="text-end text-ink-muted">
                          <Money amount={entry.old_amount} currency={entry.currency} />
                        </Td>
                        <Td className="text-end">
                          <Money amount={entry.new_amount} currency={entry.currency} />
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
