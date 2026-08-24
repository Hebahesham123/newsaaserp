'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { Notice } from '@/components/ui';
import {
  addBundleComponent,
  createVariant,
  saveCost,
  saveMapping,
  savePrice,
  setProductCollections,
  updateVariant,
} from '../actions';

/**
 * The dialogs behind the product workspace (§3.4–§3.9).
 *
 * Each is a thin field spec over the matching server action; validation,
 * pending state and error surfacing come from EntityForm.
 */

export type Option = { id: string; name: string };

const PRICE_TYPES = [
  'base', 'compare_at', 'wholesale', 'store', 'merchant', 'marketplace',
  'country', 'affiliate', 'promotional', 'bundle', 'time_based', 'quantity_based',
] as const;

const COST_COMPONENTS = [
  'purchase', 'manufacturing', 'freight', 'customs', 'packaging', 'storage',
  'fulfillment', 'marketplace_commission', 'affiliate_commission',
  'payment_gateway', 'customer_shipping', 'other',
] as const;

const MASTER_SOURCES = ['system', 'channel', 'bidirectional'] as const;
const MAPPING_STATUSES = ['mapped', 'unmapped', 'conflict', 'error'] as const;

/** §3.4 how many option axes the variant dialog offers at once. */
const OPTION_AXES = 3;

const toOptions = (rows: Option[]) => rows.map((row) => ({ value: row.id, label: row.name }));

/** Variant scope selector — a null variant means the row applies to the product. */
function variantField(
  t: ReturnType<typeof useI18n>['t'],
  variants: Option[],
  defaultValue?: string | null,
): FieldSpec {
  return {
    kind: 'select',
    name: 'variant_id',
    label: t.products.variants,
    defaultValue,
    options: toOptions(variants),
    placeholder: `${t.common.all} (${t.products.title})`,
    hint: 'Leave empty to apply to every variant.',
  };
}

/* -------------------------------------------------------------------------- */
/* Variants — §3.4                                                            */
/* -------------------------------------------------------------------------- */

export type VariantDraft = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string | null;
  options: Record<string, string>;
  price: number | null;
  cost: number | null;
  weight_grams: number | null;
  image_url: string | null;
  position: number;
  is_active: boolean;
};

export function VariantForm({
  productId,
  variant,
  axes,
}: {
  productId: string;
  variant?: VariantDraft;
  /** Attribute codes flagged as variant axes (§3.6). */
  axes: string[];
}) {
  const { t } = useI18n();
  const editing = variant != null;

  const entries = Object.entries(variant?.options ?? {});

  // Repeated `option_name` / `option_value` inputs; the action folds them into
  // the options object by position.
  const optionFields: FieldSpec[] = Array.from({ length: OPTION_AXES }).flatMap((_, index) => {
    const [name, value] = entries[index] ?? ['', ''];
    return [
      axes.length > 0
        ? ({
            kind: 'select',
            name: 'option_name',
            label: `${t.products.optionAxis} ${index + 1}`,
            defaultValue: name,
            options: axes.map((axis) => ({ value: axis, label: axis })),
          } satisfies FieldSpec)
        : ({
            kind: 'text',
            name: 'option_name',
            label: `${t.products.optionAxis} ${index + 1}`,
            defaultValue: name,
            placeholder: 'colour',
          } satisfies FieldSpec),
      {
        kind: 'text',
        name: 'option_value',
        label: `${t.products.optionValue} ${index + 1}`,
        defaultValue: value,
        placeholder: 'Red',
      } satisfies FieldSpec,
    ];
  });

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'product_id', value: productId },
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: variant.id }] as FieldSpec[]) : []),

    { kind: 'text', name: 'sku', label: t.products.sku, defaultValue: variant?.sku, required: true, dir: 'ltr' },
    { kind: 'text', name: 'barcode', label: t.products.barcode, defaultValue: variant?.barcode, dir: 'ltr' },
    { kind: 'text', name: 'name', label: t.common.name, defaultValue: variant?.name, full: true },

    { kind: 'section', label: t.products.options },
    ...optionFields,

    { kind: 'section', label: t.products.commercial },
    { kind: 'text', name: 'price', label: t.products.basePrice, type: 'number', step: '0.01', min: 0, defaultValue: variant?.price },
    { kind: 'text', name: 'cost', label: t.products.baseCost, type: 'number', step: '0.01', min: 0, defaultValue: variant?.cost },
    { kind: 'text', name: 'weight_grams', label: t.products.weight, type: 'number', step: '0.001', min: 0, defaultValue: variant?.weight_grams },
    { kind: 'text', name: 'position', label: t.catalog.sortOrder, type: 'number', defaultValue: variant?.position ?? 0 },
    { kind: 'text', name: 'image_url', label: t.catalog.logoUrl, defaultValue: variant?.image_url, dir: 'ltr', full: true },
    { kind: 'checkbox', name: 'is_active', label: t.common.active, defaultChecked: variant?.is_active ?? true },
  ];

  return (
    <EntityForm
      action={editing ? updateVariant : createVariant}
      title={editing ? t.products.editVariant : t.products.addVariant}
      description={editing ? variant.sku : undefined}
      fields={fields}
      trigger={editing ? t.common.edit : t.products.addVariant}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'secondary'}
      triggerSize="sm"
      submitLabel={editing ? t.common.saveChanges : t.common.add}
      size="lg"
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Price matrix — §3.7                                                        */
/* -------------------------------------------------------------------------- */

export type PriceDraft = {
  id: string;
  variant_id: string | null;
  price_type: string;
  amount: number;
  currency: string;
  store_id: string | null;
  country: string | null;
  min_quantity: number | null;
  valid_from: string | null;
  valid_to: string | null;
  priority: number;
  is_active: boolean;
  note: string | null;
};

export function PriceForm({
  productId,
  currency,
  variants,
  stores,
  price,
}: {
  productId: string;
  currency: string;
  variants: Option[];
  stores: Option[];
  price?: PriceDraft;
}) {
  const { t } = useI18n();
  const editing = price != null;

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'product_id', value: productId },
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: price.id }] as FieldSpec[]) : []),

    {
      kind: 'select',
      name: 'price_type',
      label: t.products.priceType,
      defaultValue: price?.price_type ?? 'base',
      required: true,
      options: PRICE_TYPES.map((value) => ({ value, label: t.priceType[value] })),
    },
    { kind: 'text', name: 'amount', label: t.products.amount, type: 'number', step: '0.01', min: 0, defaultValue: price?.amount, required: true },
    { kind: 'text', name: 'currency', label: t.common.currency, defaultValue: price?.currency ?? currency, required: true, dir: 'ltr' },
    variantField(t, variants, price?.variant_id),

    { kind: 'section', label: t.products.scope },
    { kind: 'select', name: 'store_id', label: t.nav.stores, defaultValue: price?.store_id, options: toOptions(stores) },
    { kind: 'text', name: 'country', label: t.common.country, defaultValue: price?.country },
    {
      kind: 'text',
      name: 'min_quantity',
      label: t.products.minQuantity,
      type: 'number',
      min: 1,
      defaultValue: price?.min_quantity,
      hint: 'Required for a quantity break.',
    },
    { kind: 'text', name: 'priority', label: t.products.priority, type: 'number', defaultValue: price?.priority ?? 0 },
    { kind: 'text', name: 'valid_from', label: t.products.validFrom, type: 'date', defaultValue: price?.valid_from?.slice(0, 10) },
    { kind: 'text', name: 'valid_to', label: t.products.validTo, type: 'date', defaultValue: price?.valid_to?.slice(0, 10) },
    { kind: 'checkbox', name: 'is_active', label: t.common.active, defaultChecked: price?.is_active ?? true },
    { kind: 'textarea', name: 'note', label: t.common.notes, defaultValue: price?.note, rows: 2 },
  ];

  return (
    <EntityForm
      action={savePrice}
      title={editing ? t.products.editPrice : t.products.addPrice}
      fields={fields}
      trigger={editing ? t.common.edit : t.products.addPrice}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'secondary'}
      triggerSize="sm"
      submitLabel={editing ? t.common.saveChanges : t.common.add}
      size="lg"
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Cost components — §3.8                                                     */
/* -------------------------------------------------------------------------- */

export type CostDraft = {
  id: string;
  variant_id: string | null;
  component: string;
  amount: number;
  currency: string;
  is_percentage: boolean;
  effective_from: string | null;
  effective_to: string | null;
  note: string | null;
};

export function CostForm({
  productId,
  currency,
  variants,
  cost,
}: {
  productId: string;
  currency: string;
  variants: Option[];
  cost?: CostDraft;
}) {
  const { t } = useI18n();
  const editing = cost != null;

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'product_id', value: productId },
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: cost.id }] as FieldSpec[]) : []),

    {
      kind: 'select',
      name: 'component',
      label: t.products.costComponent,
      defaultValue: cost?.component ?? 'purchase',
      required: true,
      options: COST_COMPONENTS.map((value) => ({ value, label: t.costComponent[value] })),
    },
    { kind: 'text', name: 'amount', label: t.products.amount, type: 'number', step: '0.0001', min: 0, defaultValue: cost?.amount, required: true },
    { kind: 'text', name: 'currency', label: t.common.currency, defaultValue: cost?.currency ?? currency, required: true, dir: 'ltr' },
    variantField(t, variants, cost?.variant_id),
    {
      kind: 'checkbox',
      name: 'is_percentage',
      label: t.products.isPercentage,
      defaultChecked: cost?.is_percentage ?? false,
      hint: 'Commissions are naturally a percentage of the selling price.',
    },
    { kind: 'text', name: 'effective_from', label: t.products.effectiveFrom, type: 'date', defaultValue: cost?.effective_from },
    { kind: 'text', name: 'effective_to', label: t.products.effectiveTo, type: 'date', defaultValue: cost?.effective_to },
    { kind: 'textarea', name: 'note', label: t.common.notes, defaultValue: cost?.note, rows: 2 },
  ];

  return (
    <EntityForm
      action={saveCost}
      title={editing ? t.products.editCost : t.products.addCost}
      fields={fields}
      trigger={editing ? t.common.edit : t.products.addCost}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'secondary'}
      triggerSize="sm"
      submitLabel={editing ? t.common.saveChanges : t.common.add}
      size="lg"
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Channel mapping — §3.5                                                     */
/* -------------------------------------------------------------------------- */

export type MappingDraft = {
  id: string;
  variant_id: string | null;
  store_id: string;
  external_product_id: string | null;
  external_variant_id: string | null;
  external_sku: string | null;
  asin: string | null;
  marketplace_fulfillment_sku: string | null;
  external_url: string | null;
  master_source: string;
  status: string;
};

export function MappingForm({
  productId,
  variants,
  stores,
  mapping,
}: {
  productId: string;
  variants: Option[];
  stores: Option[];
  mapping?: MappingDraft;
}) {
  const { t } = useI18n();
  const editing = mapping != null;

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'product_id', value: productId },
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: mapping.id }] as FieldSpec[]) : []),

    {
      kind: 'select',
      name: 'store_id',
      label: t.nav.stores,
      defaultValue: mapping?.store_id,
      required: true,
      options: toOptions(stores),
    },
    variantField(t, variants, mapping?.variant_id),

    { kind: 'section', label: t.products.mappings },
    { kind: 'text', name: 'external_product_id', label: t.products.externalProductId, defaultValue: mapping?.external_product_id, dir: 'ltr' },
    { kind: 'text', name: 'external_variant_id', label: t.products.externalVariantId, defaultValue: mapping?.external_variant_id, dir: 'ltr' },
    { kind: 'text', name: 'external_sku', label: t.products.externalSku, defaultValue: mapping?.external_sku, dir: 'ltr' },
    { kind: 'text', name: 'asin', label: t.products.asin, defaultValue: mapping?.asin, dir: 'ltr' },
    { kind: 'text', name: 'marketplace_fulfillment_sku', label: t.products.fulfillmentSku, defaultValue: mapping?.marketplace_fulfillment_sku, dir: 'ltr' },
    { kind: 'text', name: 'external_url', label: t.products.externalUrl, defaultValue: mapping?.external_url, dir: 'ltr', full: true },

    {
      kind: 'select',
      name: 'master_source',
      label: t.products.masterSource,
      defaultValue: mapping?.master_source ?? 'system',
      required: true,
      options: MASTER_SOURCES.map((value) => ({ value, label: value })),
      hint: 'Which side wins when both change (§3.10).',
    },
    {
      kind: 'select',
      name: 'status',
      label: t.products.mappingStatus,
      defaultValue: mapping?.status ?? 'mapped',
      required: true,
      options: MAPPING_STATUSES.map((value) => ({ value, label: t.mappingStatus[value] })),
    },
  ];

  return (
    <EntityForm
      action={saveMapping}
      title={editing ? t.products.editMapping : t.products.addMapping}
      fields={fields}
      trigger={editing ? t.common.edit : t.products.addMapping}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'secondary'}
      triggerSize="sm"
      submitLabel={editing ? t.common.saveChanges : t.common.add}
      size="lg"
      banner={
        stores.length === 0 ? (
          <Notice tone="warning">Connect a store before mapping this product to a channel.</Notice>
        ) : undefined
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Bundle components — §3.9                                                   */
/* -------------------------------------------------------------------------- */

export function ComponentForm({
  bundleProductId,
  candidates,
}: {
  bundleProductId: string;
  candidates: Option[];
}) {
  const { t } = useI18n();

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'bundle_product_id', value: bundleProductId },
    {
      kind: 'select',
      name: 'component_variant_id',
      label: t.products.component,
      required: true,
      full: true,
      options: toOptions(candidates),
    },
    { kind: 'text', name: 'quantity', label: t.products.quantity, type: 'number', step: '0.001', min: 0, defaultValue: 1 },
    { kind: 'text', name: 'position', label: t.catalog.sortOrder, type: 'number', defaultValue: 0 },
    { kind: 'checkbox', name: 'is_required', label: t.products.required, defaultChecked: true },
  ];

  return (
    <EntityForm
      action={addBundleComponent}
      title={t.products.addComponent}
      description={t.products.bundleSubtitle}
      fields={fields}
      trigger={t.products.addComponent}
      triggerVariant="secondary"
      triggerSize="sm"
      submitLabel={t.common.add}
      banner={
        candidates.length === 0 ? (
          <Notice tone="warning">
            No other sellable variants exist for this merchant yet — create the component products first.
          </Notice>
        ) : undefined
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Collection membership — §3.6                                               */
/* -------------------------------------------------------------------------- */

export function CollectionsForm({
  productId,
  collections,
  selected,
}: {
  productId: string;
  collections: Option[];
  selected: string[];
}) {
  const { t } = useI18n();

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'id', value: productId },
    {
      kind: 'multi',
      name: 'collections',
      label: t.products.collections,
      options: toOptions(collections),
      selected,
      columns: 2,
      full: true,
    },
  ];

  return (
    <EntityForm
      action={setProductCollections}
      title={t.products.collections}
      fields={fields}
      trigger={t.common.manage}
      triggerIcon="pencil"
      triggerVariant="ghost"
      triggerSize="sm"
      submitLabel={t.common.saveChanges}
      banner={
        collections.length === 0 ? (
          <Notice tone="info">No collections exist yet. Create one under Brands &amp; Categories.</Notice>
        ) : undefined
      }
    />
  );
}
