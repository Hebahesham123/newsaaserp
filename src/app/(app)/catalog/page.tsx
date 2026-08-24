import { requirePermission, can } from '@/lib/auth/session';
import { getDictionary, getLocale } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Badge, Card, EmptyState, PageHeader, Table, Tabs, Td, Th, Tr } from '@/components/ui';
import { DateOnly } from '@/components/status-badge';
import { ActionButton } from '@/components/form/action-button';
import {
  AttributeForm,
  BrandForm,
  CategoryForm,
  CollectionForm,
  UnitForm,
  type Option,
} from './forms';
import { archiveBrand, archiveCategory } from './actions';

const TABS = ['brands', 'categories', 'collections', 'units', 'attributes'] as const;
type Tab = (typeof TABS)[number];

/**
 * §3.6 Catalog Management.
 *
 * Five small reference tables that share one permission, so they share one
 * screen rather than five sidebar entries. The tab lives in the URL, which
 * keeps each list linkable and the back button meaningful.
 */
export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requirePermission('products.view');
  const { tab } = await searchParams;
  const t = await getDictionary();
  const locale = await getLocale();
  const supabase = await createServerSupabase();

  const active: Tab = (TABS as readonly string[]).includes(tab ?? '') ? (tab as Tab) : 'brands';
  const canManage = can(session, 'catalog.manage');

  const [
    { data: brands },
    { data: categories },
    { data: collections },
    { data: units },
    { data: attributes },
    { data: merchants },
    companiesResult,
  ] = await Promise.all([
    supabase.from('brands').select('*').is('archived_at', null).order('name_en'),
    supabase.from('categories').select('*').is('archived_at', null).order('sort_order'),
    supabase.from('collections').select('*').order('name_en'),
    supabase.from('units_of_measure').select('*').order('code'),
    supabase.from('product_attributes').select('*').order('sort_order'),
    supabase.from('merchants').select('id, name').is('archived_at', null).order('name'),
    session.profile.company_id
      ? Promise.resolve({ data: null })
      : supabase.from('companies').select('id, name_en, name_ar').is('archived_at', null).order('name_en'),
  ]);

  const localise = (row: { name_en: string; name_ar: string }) =>
    locale === 'ar' ? row.name_ar : row.name_en;

  const merchantOptions: Option[] = (merchants ?? []).map((m) => ({ id: m.id, name: m.name }));
  const companyOptions: Option[] | undefined = session.profile.company_id
    ? undefined
    : (companiesResult.data ?? []).map((c) => ({ id: c.id, name: localise(c) }));

  const categoryOptions: Option[] = (categories ?? []).map((c) => ({ id: c.id, name: localise(c) }));

  const categoryName = (id: string | null) =>
    id ? (categoryOptions.find((option) => option.id === id)?.name ?? '—') : t.catalog.topLevel;
  const merchantName = (id: string | null) =>
    id ? (merchantOptions.find((option) => option.id === id)?.name ?? '—') : t.warehouses.shared;

  const createAction = {
    brands: <BrandForm merchants={merchantOptions} companies={companyOptions} />,
    categories: <CategoryForm parents={categoryOptions} companies={companyOptions} />,
    collections: <CollectionForm merchants={merchantOptions} companies={companyOptions} />,
    units: <UnitForm companies={companyOptions} />,
    attributes: <AttributeForm companies={companyOptions} />,
  }[active];

  return (
    <>
      <PageHeader
        title={t.catalog.title}
        subtitle={t.catalog.subtitle}
        actions={canManage ? createAction : null}
      />

      <Tabs
        active={`/catalog?tab=${active}`}
        items={[
          { href: '/catalog?tab=brands', label: t.catalog.brands, count: brands?.length },
          { href: '/catalog?tab=categories', label: t.catalog.categories, count: categories?.length },
          { href: '/catalog?tab=collections', label: t.catalog.collections, count: collections?.length },
          { href: '/catalog?tab=units', label: t.catalog.units, count: units?.length },
          { href: '/catalog?tab=attributes', label: t.catalog.attributes, count: attributes?.length },
        ]}
      />

      <Card>
        {/* ------------------------------------------------------------ */}
        {active === 'brands' ? (
          !brands || brands.length === 0 ? (
            <EmptyState title={t.common.noResults} hint={t.catalog.subtitle} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t.common.code}</Th>
                  <Th>{t.common.name}</Th>
                  <Th>{t.stores.merchant}</Th>
                  <Th>{t.common.status}</Th>
                  {canManage ? <Th className="text-end">{t.common.actions}</Th> : null}
                </tr>
              </thead>
              <tbody>
                {brands.map((brand) => (
                  <Tr key={brand.id}>
                    <Td className="tnum font-medium" dir="ltr">{brand.code}</Td>
                    <Td>{localise(brand)}</Td>
                    <Td className="text-ink-muted">{merchantName(brand.merchant_id)}</Td>
                    <Td>
                      <Badge tone={brand.is_active ? 'success' : 'neutral'}>
                        {brand.is_active ? t.common.active : t.common.inactive}
                      </Badge>
                    </Td>
                    {canManage ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <BrandForm
                            brand={{
                              id: brand.id,
                              code: brand.code,
                              name_en: brand.name_en,
                              name_ar: brand.name_ar,
                              merchant_id: brand.merchant_id,
                              logo_url: brand.logo_url,
                              description: brand.description,
                              is_active: brand.is_active,
                            }}
                            merchants={merchantOptions}
                          />
                          <ActionButton
                            action={archiveBrand}
                            fields={{ id: brand.id }}
                            label={t.common.archive}
                            icon="archive"
                            confirm={t.common.archiveConfirm}
                            iconOnly
                          />
                        </div>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}

        {/* ------------------------------------------------------------ */}
        {active === 'categories' ? (
          !categories || categories.length === 0 ? (
            <EmptyState title={t.common.noResults} hint={t.catalog.subtitle} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t.common.code}</Th>
                  <Th>{t.common.name}</Th>
                  <Th>{t.catalog.parent}</Th>
                  <Th className="text-end">{t.catalog.sortOrder}</Th>
                  <Th>{t.common.status}</Th>
                  {canManage ? <Th className="text-end">{t.common.actions}</Th> : null}
                </tr>
              </thead>
              <tbody>
                {categories.map((category) => (
                  <Tr key={category.id}>
                    <Td className="tnum font-medium" dir="ltr">{category.code}</Td>
                    <Td>{localise(category)}</Td>
                    <Td className="text-ink-muted">{categoryName(category.parent_id)}</Td>
                    <Td className="tnum text-end text-ink-muted">{category.sort_order}</Td>
                    <Td>
                      <Badge tone={category.is_active ? 'success' : 'neutral'}>
                        {category.is_active ? t.common.active : t.common.inactive}
                      </Badge>
                    </Td>
                    {canManage ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <CategoryForm
                            category={{
                              id: category.id,
                              code: category.code,
                              name_en: category.name_en,
                              name_ar: category.name_ar,
                              parent_id: category.parent_id,
                              description: category.description,
                              sort_order: category.sort_order,
                              is_active: category.is_active,
                            }}
                            parents={categoryOptions}
                          />
                          <ActionButton
                            action={archiveCategory}
                            fields={{ id: category.id }}
                            label={t.common.archive}
                            icon="archive"
                            confirm={t.common.archiveConfirm}
                            iconOnly
                          />
                        </div>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}

        {/* ------------------------------------------------------------ */}
        {active === 'collections' ? (
          !collections || collections.length === 0 ? (
            <EmptyState title={t.common.noResults} hint={t.catalog.subtitle} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t.common.code}</Th>
                  <Th>{t.common.name}</Th>
                  <Th>{t.stores.merchant}</Th>
                  <Th>{t.products.seasonal}</Th>
                  <Th>{t.common.status}</Th>
                  {canManage ? <Th className="text-end">{t.common.actions}</Th> : null}
                </tr>
              </thead>
              <tbody>
                {collections.map((collection) => (
                  <Tr key={collection.id}>
                    <Td className="tnum font-medium" dir="ltr">{collection.code}</Td>
                    <Td>{localise(collection)}</Td>
                    <Td className="text-ink-muted">{merchantName(collection.merchant_id)}</Td>
                    <Td className="text-ink-muted">
                      {collection.is_seasonal ? (
                        <span className="text-xs">
                          <DateOnly value={collection.season_start} /> — <DateOnly value={collection.season_end} />
                        </span>
                      ) : (
                        t.common.no
                      )}
                    </Td>
                    <Td>
                      <Badge tone={collection.is_active ? 'success' : 'neutral'}>
                        {collection.is_active ? t.common.active : t.common.inactive}
                      </Badge>
                    </Td>
                    {canManage ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <CollectionForm
                            collection={{
                              id: collection.id,
                              code: collection.code,
                              name_en: collection.name_en,
                              name_ar: collection.name_ar,
                              merchant_id: collection.merchant_id,
                              description: collection.description,
                              is_seasonal: collection.is_seasonal,
                              season_start: collection.season_start,
                              season_end: collection.season_end,
                              is_active: collection.is_active,
                            }}
                            merchants={merchantOptions}
                          />
                        </div>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}

        {/* ------------------------------------------------------------ */}
        {active === 'units' ? (
          !units || units.length === 0 ? (
            <EmptyState title={t.common.noResults} hint={t.catalog.subtitle} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t.common.code}</Th>
                  <Th>{t.common.name}</Th>
                  <Th>{t.catalog.allowsFractions}</Th>
                  <Th>{t.common.status}</Th>
                  {canManage ? <Th className="text-end">{t.common.actions}</Th> : null}
                </tr>
              </thead>
              <tbody>
                {units.map((unit) => (
                  <Tr key={unit.id}>
                    <Td className="tnum font-medium" dir="ltr">{unit.code}</Td>
                    <Td>{localise(unit)}</Td>
                    <Td className="text-ink-muted">
                      {unit.allows_fractions ? t.common.yes : t.common.no}
                    </Td>
                    <Td>
                      <Badge tone={unit.is_active ? 'success' : 'neutral'}>
                        {unit.is_active ? t.common.active : t.common.inactive}
                      </Badge>
                    </Td>
                    {canManage ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <UnitForm
                            unit={{
                              id: unit.id,
                              code: unit.code,
                              name_en: unit.name_en,
                              name_ar: unit.name_ar,
                              allows_fractions: unit.allows_fractions,
                              is_active: unit.is_active,
                            }}
                          />
                        </div>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}

        {/* ------------------------------------------------------------ */}
        {active === 'attributes' ? (
          !attributes || attributes.length === 0 ? (
            <EmptyState title={t.common.noResults} hint={t.catalog.subtitle} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t.common.code}</Th>
                  <Th>{t.common.name}</Th>
                  <Th>{t.catalog.values}</Th>
                  <Th>{t.catalog.variantAxis}</Th>
                  {canManage ? <Th className="text-end">{t.common.actions}</Th> : null}
                </tr>
              </thead>
              <tbody>
                {attributes.map((attribute) => (
                  <Tr key={attribute.id}>
                    <Td className="tnum font-medium" dir="ltr">{attribute.code}</Td>
                    <Td>{localise(attribute)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {attribute.values.length === 0 ? (
                          <span className="text-xs text-ink-subtle">{t.catalog.valuesHint}</span>
                        ) : (
                          attribute.values.map((value) => (
                            <Badge key={value} className="text-[10px]">
                              {value}
                            </Badge>
                          ))
                        )}
                      </div>
                    </Td>
                    <Td className="text-ink-muted">
                      {attribute.is_variant_axis ? t.common.yes : t.common.no}
                    </Td>
                    {canManage ? (
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <AttributeForm
                            attribute={{
                              id: attribute.id,
                              code: attribute.code,
                              name_en: attribute.name_en,
                              name_ar: attribute.name_ar,
                              values: attribute.values,
                              is_variant_axis: attribute.is_variant_axis,
                              sort_order: attribute.sort_order,
                            }}
                          />
                        </div>
                      </Td>
                    ) : null}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )
        ) : null}
      </Card>
    </>
  );
}
