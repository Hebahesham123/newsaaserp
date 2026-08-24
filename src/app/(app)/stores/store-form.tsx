'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { createStore, updateStore } from './actions';

export type StoreDraft = {
  id: string;
  merchant_id: string;
  code: string;
  name: string;
  platform: string;
  store_url: string | null;
  currency: string;
  country: string | null;
  locale: string;
  timezone: string;
  default_warehouse_id: string | null;
  store_manager_id: string | null;
  order_import_method: string;
  product_sync_method: string;
  inventory_sync_method: string;
  price_sync_method: string;
  sync_enabled: boolean;
  notes: string | null;
};

export type Option = { id: string; name: string };

const PLATFORMS = [
  'shopify', 'woocommerce', 'amazon', 'noon', 'custom_store', 'mobile_app',
  'pos', 'branch', 'social_commerce', 'manual', 'wholesale', 'other_marketplace',
] as const;

const METHODS = ['webhook', 'scheduled', 'manual', 'disabled'] as const;

export function StoreForm({
  store,
  merchants,
  warehouses,
  managers,
  defaultMerchantId,
}: {
  store?: StoreDraft;
  merchants: Option[];
  warehouses: Option[];
  managers: Option[];
  defaultMerchantId?: string;
}) {
  const { t } = useI18n();
  const editing = store != null;

  const methodOptions = METHODS.map((method) => ({ value: method, label: method }));

  const fields: FieldSpec[] = [
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: store.id }] as FieldSpec[]) : []),

    { kind: 'section', label: t.companies.identity },
    {
      kind: 'select',
      name: 'merchant_id',
      label: t.stores.merchant,
      defaultValue: store?.merchant_id ?? defaultMerchantId ?? '',
      required: true,
      options: merchants.map((merchant) => ({ value: merchant.id, label: merchant.name })),
    },
    {
      kind: 'select',
      name: 'platform',
      label: t.stores.platform,
      defaultValue: store?.platform ?? 'shopify',
      required: true,
      options: PLATFORMS.map((platform) => ({ value: platform, label: t.platform[platform] })),
    },
    { kind: 'text', name: 'code', label: t.common.code, defaultValue: store?.code, required: true, dir: 'ltr', placeholder: 'NRA-SHOP' },
    { kind: 'text', name: 'name', label: t.common.name, defaultValue: store?.name, required: true },
    { kind: 'text', name: 'store_url', label: t.stores.storeUrl, defaultValue: store?.store_url, dir: 'ltr', placeholder: 'https://shop.example.com', full: true },
    { kind: 'text', name: 'currency', label: t.common.currency, defaultValue: store?.currency ?? 'EGP', required: true, dir: 'ltr' },
    { kind: 'text', name: 'country', label: t.common.country, defaultValue: store?.country },
    {
      kind: 'select',
      name: 'locale',
      label: t.common.locale,
      defaultValue: store?.locale ?? 'ar',
      required: true,
      options: [
        { value: 'ar', label: 'العربية' },
        { value: 'en', label: 'English' },
      ],
    },
    { kind: 'text', name: 'timezone', label: t.common.timezone, defaultValue: store?.timezone ?? 'Africa/Cairo', dir: 'ltr' },

    { kind: 'section', label: t.common.settings },
    {
      kind: 'select',
      name: 'default_warehouse_id',
      label: t.stores.defaultWarehouse,
      defaultValue: store?.default_warehouse_id,
      options: warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name })),
    },
    {
      kind: 'select',
      name: 'store_manager_id',
      label: t.stores.storeManager,
      defaultValue: store?.store_manager_id,
      options: managers.map((manager) => ({ value: manager.id, label: manager.name })),
    },

    { kind: 'section', label: t.stores.syncSettings },
    { kind: 'select', name: 'order_import_method', label: t.stores.orderImportMethod, defaultValue: store?.order_import_method ?? 'webhook', required: true, options: methodOptions },
    { kind: 'select', name: 'product_sync_method', label: t.stores.productSyncMethod, defaultValue: store?.product_sync_method ?? 'scheduled', required: true, options: methodOptions },
    { kind: 'select', name: 'inventory_sync_method', label: t.stores.inventorySyncMethod, defaultValue: store?.inventory_sync_method ?? 'scheduled', required: true, options: methodOptions },
    { kind: 'select', name: 'price_sync_method', label: t.stores.priceSyncMethod, defaultValue: store?.price_sync_method ?? 'manual', required: true, options: methodOptions },
    {
      kind: 'checkbox',
      name: 'sync_enabled',
      label: t.stores.syncEnabled,
      defaultChecked: store?.sync_enabled ?? true,
      hint: 'Synchronization also stops automatically when the merchant or company is suspended (§2.13 rule 15).',
      full: true,
    },

    { kind: 'textarea', name: 'notes', label: t.common.notes, defaultValue: store?.notes },
  ];

  return (
    <EntityForm
      action={editing ? updateStore : createStore}
      title={editing ? t.stores.editTitle : t.stores.createTitle}
      description={editing ? store.name : undefined}
      fields={fields}
      trigger={editing ? t.common.edit : t.stores.createTitle}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
      size="lg"
    />
  );
}
