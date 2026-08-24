'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { Notice } from '@/components/ui';
import { createProduct, updateProduct } from './actions';

/**
 * §3.2 product master form.
 *
 * The same field spec serves create and edit because `updateProduct` parses the
 * whole schema — a partial edit form would fail validation on the fields it
 * omitted.
 */

export type ProductDraft = {
  id: string;
  merchant_id: string;
  sku: string;
  barcode: string | null;
  name_en: string;
  name_ar: string;
  short_description: string | null;
  description: string | null;
  product_type: string;
  status: string;
  brand_id: string | null;
  category_id: string | null;
  supplier_id: string | null;
  uom_id: string | null;
  weight_grams: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  country_of_origin: string | null;
  base_price: number | null;
  base_cost: number | null;
  currency: string;
  tax_rate: number | null;
  tax_included: boolean;
  min_sale_quantity: number;
  max_sale_quantity: number | null;
  is_sellable: boolean;
  is_stock_item: boolean;
  is_batch_tracked: boolean;
  is_expiry_tracked: boolean;
  is_serial_tracked: boolean;
  shelf_life_days: number | null;
  tags: string[];
  is_seasonal: boolean;
  internal_notes: string | null;
};

export type Option = { id: string; name: string };

const PRODUCT_TYPES = [
  'simple', 'variant', 'bundle', 'kit', 'composite', 'digital', 'service',
  'marketplace', 'made_to_order', 'batch_controlled', 'serial_controlled',
] as const;

const PRODUCT_STATUSES = [
  'draft', 'under_review', 'active', 'inactive', 'unavailable', 'out_of_stock',
  'temporarily_suspended', 'discontinued', 'archived', 'sync_error', 'unmapped',
] as const;

export function ProductForm({
  product,
  merchants,
  brands,
  categories,
  suppliers,
  units,
  canEditIdentifiers = true,
}: {
  product?: ProductDraft;
  merchants: Option[];
  brands: Option[];
  categories: Option[];
  suppliers: Option[];
  units: Option[];
  /** §3.12 — SKU and barcode sit behind their own permission. */
  canEditIdentifiers?: boolean;
}) {
  const { t } = useI18n();
  const editing = product != null;

  const toOptions = (rows: Option[]) => rows.map((row) => ({ value: row.id, label: row.name }));

  const fields: FieldSpec[] = [
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: product.id }] as FieldSpec[]) : []),

    { kind: 'section', label: t.companies.identity },
    {
      kind: 'select',
      name: 'merchant_id',
      label: t.stores.merchant,
      defaultValue: product?.merchant_id,
      required: true,
      options: toOptions(merchants),
      hint: editing ? undefined : t.merchants.noCompanyHint,
    },
    {
      kind: 'select',
      name: 'product_type',
      label: t.products.productType,
      defaultValue: product?.product_type ?? 'simple',
      required: true,
      options: PRODUCT_TYPES.map((type) => ({ value: type, label: t.productType[type] })),
    },
    {
      kind: 'text',
      name: 'sku',
      label: t.products.sku,
      defaultValue: product?.sku,
      required: true,
      dir: 'ltr',
      placeholder: 'TSH-BLK-M',
      readOnly: !canEditIdentifiers,
      hint: editing ? undefined : 'Unique within the merchant (§3.13 rule 3).',
    },
    {
      kind: 'text',
      name: 'barcode',
      label: t.products.barcode,
      defaultValue: product?.barcode,
      dir: 'ltr',
      readOnly: !canEditIdentifiers,
    },
    { kind: 'text', name: 'name_en', label: t.companies.nameEn, defaultValue: product?.name_en, required: true },
    { kind: 'text', name: 'name_ar', label: t.companies.nameAr, defaultValue: product?.name_ar, required: true, dir: 'rtl' },
    {
      kind: 'select',
      name: 'status',
      label: t.common.status,
      defaultValue: product?.status ?? 'draft',
      required: true,
      options: PRODUCT_STATUSES.map((status) => ({ value: status, label: t.productStatus[status] })),
      hint: t.products.publishBlocked,
    },
    { kind: 'text', name: 'short_description', label: t.common.description, defaultValue: product?.short_description },
    { kind: 'textarea', name: 'description', label: t.common.details, defaultValue: product?.description, rows: 3 },

    { kind: 'section', label: t.catalog.title },
    { kind: 'select', name: 'brand_id', label: t.products.brand, defaultValue: product?.brand_id, options: toOptions(brands) },
    { kind: 'select', name: 'category_id', label: t.products.category, defaultValue: product?.category_id, options: toOptions(categories) },
    { kind: 'select', name: 'supplier_id', label: t.products.supplier, defaultValue: product?.supplier_id, options: toOptions(suppliers) },
    { kind: 'select', name: 'uom_id', label: t.products.uom, defaultValue: product?.uom_id, options: toOptions(units) },
    {
      kind: 'text',
      name: 'tags',
      label: t.products.tags,
      defaultValue: product?.tags.join(', '),
      full: true,
      hint: t.catalog.valuesHint,
    },

    { kind: 'section', label: t.products.commercial },
    { kind: 'text', name: 'base_price', label: t.products.basePrice, type: 'number', step: '0.01', min: 0, defaultValue: product?.base_price },
    { kind: 'text', name: 'base_cost', label: t.products.baseCost, type: 'number', step: '0.01', min: 0, defaultValue: product?.base_cost },
    { kind: 'text', name: 'currency', label: t.common.currency, defaultValue: product?.currency ?? 'EGP', required: true, dir: 'ltr' },
    { kind: 'text', name: 'tax_rate', label: t.products.taxRate, type: 'number', step: '0.001', min: 0, max: 100, defaultValue: product?.tax_rate },
    { kind: 'checkbox', name: 'tax_included', label: t.products.taxIncluded, defaultChecked: product?.tax_included ?? false },
    { kind: 'text', name: 'min_sale_quantity', label: t.products.minQty, type: 'number', min: 1, defaultValue: product?.min_sale_quantity ?? 1 },
    { kind: 'text', name: 'max_sale_quantity', label: t.products.maxQty, type: 'number', min: 1, defaultValue: product?.max_sale_quantity },

    { kind: 'section', label: t.products.physical },
    { kind: 'text', name: 'weight_grams', label: t.products.weight, type: 'number', step: '0.001', min: 0, defaultValue: product?.weight_grams },
    { kind: 'text', name: 'country_of_origin', label: t.products.origin, defaultValue: product?.country_of_origin },
    { kind: 'text', name: 'length_cm', label: `${t.products.dimensions} — L`, type: 'number', step: '0.01', min: 0, defaultValue: product?.length_cm },
    { kind: 'text', name: 'width_cm', label: `${t.products.dimensions} — W`, type: 'number', step: '0.01', min: 0, defaultValue: product?.width_cm },
    { kind: 'text', name: 'height_cm', label: `${t.products.dimensions} — H`, type: 'number', step: '0.01', min: 0, defaultValue: product?.height_cm },

    { kind: 'section', label: t.products.flags },
    { kind: 'checkbox', name: 'is_sellable', label: t.products.sellable, defaultChecked: product?.is_sellable ?? true },
    { kind: 'checkbox', name: 'is_stock_item', label: t.products.stockItem, defaultChecked: product?.is_stock_item ?? true },
    { kind: 'checkbox', name: 'is_seasonal', label: t.products.seasonal, defaultChecked: product?.is_seasonal ?? false },

    { kind: 'section', label: t.products.tracking },
    { kind: 'checkbox', name: 'is_batch_tracked', label: t.products.batchTracked, defaultChecked: product?.is_batch_tracked ?? false },
    { kind: 'checkbox', name: 'is_expiry_tracked', label: t.products.expiryTracked, defaultChecked: product?.is_expiry_tracked ?? false },
    { kind: 'checkbox', name: 'is_serial_tracked', label: t.products.serialTracked, defaultChecked: product?.is_serial_tracked ?? false },
    { kind: 'text', name: 'shelf_life_days', label: t.products.shelfLife, type: 'number', min: 1, defaultValue: product?.shelf_life_days },

    { kind: 'textarea', name: 'internal_notes', label: t.common.internalNotes, defaultValue: product?.internal_notes, rows: 2 },
  ];

  return (
    <EntityForm
      action={editing ? updateProduct : createProduct}
      title={editing ? t.products.editTitle : t.products.createTitle}
      description={editing ? `${product.sku} — ${product.name_en}` : undefined}
      fields={fields}
      trigger={editing ? t.common.edit : t.products.createTitle}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
      size="xl"
      banner={
        merchants.length === 0 ? (
          <Notice tone="warning">{t.merchants.noCompanyHint}</Notice>
        ) : undefined
      }
    />
  );
}
