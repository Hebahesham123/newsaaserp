'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { saveAttribute, saveBrand, saveCategory, saveCollection, saveUnit } from './actions';

/**
 * §3.6 catalog reference data.
 *
 * Brands, categories, collections, units and attributes are the same job behind
 * one `catalog.manage` permission, so they share this file rather than each
 * getting its own module.
 */

export type Option = { id: string; name: string };

/**
 * A platform admin has no implicit company, so every create form has to ask.
 * Company-scoped users never see the field — `resolveCompanyId` ignores a
 * submitted value for them anyway.
 */
function companyField(t: ReturnType<typeof useI18n>['t'], companies?: Option[]): FieldSpec[] {
  if (!companies) return [];
  return [
    {
      kind: 'select',
      name: 'company_id',
      label: t.merchants.company,
      placeholder: t.merchants.selectCompany,
      required: true,
      full: true,
      options: companies.map((company) => ({ value: company.id, label: company.name })),
    },
  ];
}

const idField = (id?: string): FieldSpec[] => (id ? [{ kind: 'hidden', name: 'id', value: id }] : []);

const CODE_HINT = 'Letters, digits, dot, hyphen and underscore only.';

/* -------------------------------------------------------------------------- */
/* Brands                                                                     */
/* -------------------------------------------------------------------------- */

export type BrandDraft = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  merchant_id: string | null;
  logo_url: string | null;
  description: string | null;
  is_active: boolean;
};

export function BrandForm({
  brand,
  merchants,
  companies,
}: {
  brand?: BrandDraft;
  merchants: Option[];
  companies?: Option[];
}) {
  const { t } = useI18n();
  const editing = brand != null;

  const fields: FieldSpec[] = [
    ...idField(brand?.id),
    ...(editing ? [] : companyField(t, companies)),
    { kind: 'text', name: 'code', label: t.common.code, defaultValue: brand?.code, required: true, dir: 'ltr', hint: CODE_HINT },
    {
      kind: 'select',
      name: 'merchant_id',
      label: t.stores.merchant,
      defaultValue: brand?.merchant_id,
      options: merchants.map((m) => ({ value: m.id, label: m.name })),
      hint: 'Leave empty to share the brand across the company.',
    },
    { kind: 'text', name: 'name_en', label: t.companies.nameEn, defaultValue: brand?.name_en, required: true },
    { kind: 'text', name: 'name_ar', label: t.companies.nameAr, defaultValue: brand?.name_ar, required: true, dir: 'rtl' },
    { kind: 'text', name: 'logo_url', label: t.catalog.logoUrl, defaultValue: brand?.logo_url, dir: 'ltr', full: true },
    { kind: 'textarea', name: 'description', label: t.common.description, defaultValue: brand?.description, rows: 2 },
    { kind: 'checkbox', name: 'is_active', label: t.common.active, defaultChecked: brand?.is_active ?? true },
  ];

  return (
    <EntityForm
      action={saveBrand}
      title={editing ? t.catalog.editBrand : t.catalog.createBrand}
      fields={fields}
      trigger={editing ? t.common.edit : t.catalog.createBrand}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export type CategoryDraft = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  parent_id: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
};

export function CategoryForm({
  category,
  parents,
  companies,
}: {
  category?: CategoryDraft;
  parents: Option[];
  companies?: Option[];
}) {
  const { t } = useI18n();
  const editing = category != null;

  const fields: FieldSpec[] = [
    ...idField(category?.id),
    ...(editing ? [] : companyField(t, companies)),
    { kind: 'text', name: 'code', label: t.common.code, defaultValue: category?.code, required: true, dir: 'ltr', hint: CODE_HINT },
    {
      kind: 'select',
      name: 'parent_id',
      label: t.catalog.parent,
      defaultValue: category?.parent_id,
      placeholder: t.catalog.topLevel,
      // A category cannot be its own parent; the DB enforces it too.
      options: parents.filter((p) => p.id !== category?.id).map((p) => ({ value: p.id, label: p.name })),
    },
    { kind: 'text', name: 'name_en', label: t.companies.nameEn, defaultValue: category?.name_en, required: true },
    { kind: 'text', name: 'name_ar', label: t.companies.nameAr, defaultValue: category?.name_ar, required: true, dir: 'rtl' },
    { kind: 'text', name: 'sort_order', label: t.catalog.sortOrder, type: 'number', defaultValue: category?.sort_order ?? 0 },
    { kind: 'textarea', name: 'description', label: t.common.description, defaultValue: category?.description, rows: 2 },
    { kind: 'checkbox', name: 'is_active', label: t.common.active, defaultChecked: category?.is_active ?? true },
  ];

  return (
    <EntityForm
      action={saveCategory}
      title={editing ? t.catalog.editCategory : t.catalog.createCategory}
      fields={fields}
      trigger={editing ? t.common.edit : t.catalog.createCategory}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Collections                                                                */
/* -------------------------------------------------------------------------- */

export type CollectionDraft = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  merchant_id: string | null;
  description: string | null;
  is_seasonal: boolean;
  season_start: string | null;
  season_end: string | null;
  is_active: boolean;
};

export function CollectionForm({
  collection,
  merchants,
  companies,
}: {
  collection?: CollectionDraft;
  merchants: Option[];
  companies?: Option[];
}) {
  const { t } = useI18n();
  const editing = collection != null;

  const fields: FieldSpec[] = [
    ...idField(collection?.id),
    ...(editing ? [] : companyField(t, companies)),
    { kind: 'text', name: 'code', label: t.common.code, defaultValue: collection?.code, required: true, dir: 'ltr', hint: CODE_HINT },
    {
      kind: 'select',
      name: 'merchant_id',
      label: t.stores.merchant,
      defaultValue: collection?.merchant_id,
      options: merchants.map((m) => ({ value: m.id, label: m.name })),
    },
    { kind: 'text', name: 'name_en', label: t.companies.nameEn, defaultValue: collection?.name_en, required: true },
    { kind: 'text', name: 'name_ar', label: t.companies.nameAr, defaultValue: collection?.name_ar, required: true, dir: 'rtl' },
    { kind: 'checkbox', name: 'is_seasonal', label: t.products.seasonal, defaultChecked: collection?.is_seasonal ?? false },
    { kind: 'text', name: 'season_start', label: t.catalog.seasonStart, type: 'date', defaultValue: collection?.season_start },
    { kind: 'text', name: 'season_end', label: t.catalog.seasonEnd, type: 'date', defaultValue: collection?.season_end },
    { kind: 'textarea', name: 'description', label: t.common.description, defaultValue: collection?.description, rows: 2 },
    { kind: 'checkbox', name: 'is_active', label: t.common.active, defaultChecked: collection?.is_active ?? true },
  ];

  return (
    <EntityForm
      action={saveCollection}
      title={editing ? t.catalog.editCollection : t.catalog.createCollection}
      fields={fields}
      trigger={editing ? t.common.edit : t.catalog.createCollection}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Units of measure                                                           */
/* -------------------------------------------------------------------------- */

export type UnitDraft = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  allows_fractions: boolean;
  is_active: boolean;
};

export function UnitForm({ unit, companies }: { unit?: UnitDraft; companies?: Option[] }) {
  const { t } = useI18n();
  const editing = unit != null;

  const fields: FieldSpec[] = [
    ...idField(unit?.id),
    ...(editing ? [] : companyField(t, companies)),
    { kind: 'text', name: 'code', label: t.common.code, defaultValue: unit?.code, required: true, dir: 'ltr', placeholder: 'PCS' },
    { kind: 'text', name: 'name_en', label: t.companies.nameEn, defaultValue: unit?.name_en, required: true },
    { kind: 'text', name: 'name_ar', label: t.companies.nameAr, defaultValue: unit?.name_ar, required: true, dir: 'rtl' },
    {
      kind: 'checkbox',
      name: 'allows_fractions',
      label: t.catalog.allowsFractions,
      defaultChecked: unit?.allows_fractions ?? false,
      hint: 'Legal for goods sold by weight, not for pieces.',
    },
    { kind: 'checkbox', name: 'is_active', label: t.common.active, defaultChecked: unit?.is_active ?? true },
  ];

  return (
    <EntityForm
      action={saveUnit}
      title={editing ? t.catalog.editUnit : t.catalog.createUnit}
      fields={fields}
      trigger={editing ? t.common.edit : t.catalog.createUnit}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Attributes — the variant axes                                              */
/* -------------------------------------------------------------------------- */

export type AttributeDraft = {
  id: string;
  code: string;
  name_en: string;
  name_ar: string;
  values: string[];
  is_variant_axis: boolean;
  sort_order: number;
};

export function AttributeForm({
  attribute,
  companies,
}: {
  attribute?: AttributeDraft;
  companies?: Option[];
}) {
  const { t } = useI18n();
  const editing = attribute != null;

  const fields: FieldSpec[] = [
    ...idField(attribute?.id),
    ...(editing ? [] : companyField(t, companies)),
    { kind: 'text', name: 'code', label: t.common.code, defaultValue: attribute?.code, required: true, dir: 'ltr', placeholder: 'colour' },
    { kind: 'text', name: 'name_en', label: t.companies.nameEn, defaultValue: attribute?.name_en, required: true },
    { kind: 'text', name: 'name_ar', label: t.companies.nameAr, defaultValue: attribute?.name_ar, required: true, dir: 'rtl' },
    {
      kind: 'textarea',
      name: 'values',
      label: t.catalog.values,
      defaultValue: attribute?.values.join(', '),
      hint: t.catalog.valuesHint,
      rows: 2,
    },
    { kind: 'text', name: 'sort_order', label: t.catalog.sortOrder, type: 'number', defaultValue: attribute?.sort_order ?? 0 },
    {
      kind: 'checkbox',
      name: 'is_variant_axis',
      label: t.catalog.variantAxis,
      defaultChecked: attribute?.is_variant_axis ?? true,
    },
  ];

  return (
    <EntityForm
      action={saveAttribute}
      title={editing ? t.catalog.editAttribute : t.catalog.createAttribute}
      fields={fields}
      trigger={editing ? t.common.edit : t.catalog.createAttribute}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
    />
  );
}
