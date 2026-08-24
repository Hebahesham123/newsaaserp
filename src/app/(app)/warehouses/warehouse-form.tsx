'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { createWarehouse, updateWarehouse } from './actions';

export type WarehouseDraft = {
  id: string;
  code: string;
  name: string;
  warehouse_type: string;
  dedicated_merchant_id: string | null;
  manager_id: string | null;
  country: string | null;
  region: string | null;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  /** jsonb — read through a narrow cast below rather than trusting its shape. */
  settings: unknown;
};

const TYPES = [
  'main', 'fulfillment', 'retail_store', 'branch', 'marketplace', 'returns', 'temporary', 'damaged',
] as const;

export function WarehouseForm({
  warehouse,
  merchants,
  managers,
  companies,
}: {
  warehouse?: WarehouseDraft;
  merchants: { id: string; name: string }[];
  managers: { id: string; name: string }[];
  companies?: { id: string; name: string }[];
}) {
  const { t } = useI18n();
  const editing = warehouse != null;
  const needsCompany = !editing && companies != null;

  const settings = (warehouse?.settings ?? {}) as { capacity_cbm?: number; dock_doors?: number };

  const fields: FieldSpec[] = [
    ...(editing ? ([{ kind: 'hidden', name: 'id', value: warehouse.id }] as FieldSpec[]) : []),

    ...(needsCompany
      ? ([
          {
            kind: 'select',
            name: 'company_id',
            label: t.merchants.company,
            placeholder: t.merchants.selectCompany,
            required: true,
            full: true,
            options: companies.map((company) => ({ value: company.id, label: company.name })),
          },
        ] as FieldSpec[])
      : []),

    { kind: 'text', name: 'code', label: t.common.code, defaultValue: warehouse?.code, required: true, dir: 'ltr', placeholder: 'WH-CAI-01' },
    { kind: 'text', name: 'name', label: t.common.name, defaultValue: warehouse?.name, required: true },
    {
      kind: 'select',
      name: 'warehouse_type',
      label: t.warehouses.warehouseType,
      defaultValue: warehouse?.warehouse_type ?? 'main',
      required: true,
      options: TYPES.map((type) => ({ value: type, label: t.warehouseType[type] })),
    },
    {
      kind: 'select',
      name: 'dedicated_merchant_id',
      label: t.warehouses.dedicatedMerchant,
      placeholder: t.warehouses.shared,
      defaultValue: warehouse?.dedicated_merchant_id,
      hint: 'Leave empty for a shared warehouse serving every merchant.',
      options: merchants.map((merchant) => ({ value: merchant.id, label: merchant.name })),
    },
    {
      kind: 'select',
      name: 'manager_id',
      label: t.warehouses.manager,
      defaultValue: warehouse?.manager_id,
      options: managers.map((manager) => ({ value: manager.id, label: manager.name })),
    },
    { kind: 'text', name: 'phone', label: t.common.phone, type: 'tel', defaultValue: warehouse?.phone, dir: 'ltr' },
    { kind: 'text', name: 'country', label: t.common.country, defaultValue: warehouse?.country },
    { kind: 'text', name: 'region', label: t.common.region, defaultValue: warehouse?.region },
    { kind: 'text', name: 'address', label: t.common.address, defaultValue: warehouse?.address, full: true },
    { kind: 'text', name: 'capacity_cbm', label: t.warehouses.capacityCbm, type: 'number', min: 0, defaultValue: settings.capacity_cbm },
    { kind: 'text', name: 'dock_doors', label: t.warehouses.dockDoors, type: 'number', min: 0, defaultValue: settings.dock_doors },
    {
      kind: 'checkbox',
      name: 'is_active',
      label: t.common.active,
      defaultChecked: warehouse?.is_active ?? true,
      full: true,
    },
  ];

  return (
    <EntityForm
      action={editing ? updateWarehouse : createWarehouse}
      title={editing ? t.warehouses.editTitle : t.warehouses.createTitle}
      description={editing ? warehouse.name : undefined}
      fields={fields}
      trigger={editing ? t.common.edit : t.warehouses.createTitle}
      triggerIcon={editing ? 'pencil' : 'plus'}
      triggerVariant={editing ? 'ghost' : 'primary'}
      triggerSize={editing ? 'sm' : 'md'}
      submitLabel={editing ? t.common.saveChanges : t.common.create}
    />
  );
}
