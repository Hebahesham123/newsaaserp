'use client';

import { useI18n } from '@/i18n/provider';
import { EntityForm, type FieldSpec } from '@/components/form/entity-form';
import { updateMerchantPricing } from '../actions';

type Pricing = {
  storage_per_cbm?: number;
  receiving_per_unit?: number;
  pick?: number;
  pack?: number;
  shipping?: number;
  return_handling?: number;
};

/**
 * §2.3.2 per-merchant fulfillment pricing.
 *
 * Separate from the merchant form because it carries its own sensitive
 * permission (merchants.pricing.edit) and a different audience: commercial
 * staff set these, operations staff only read them.
 */
export function PricingForm({ merchantId, pricing }: { merchantId: string; pricing: unknown }) {
  const { t } = useI18n();
  const values = (pricing ?? {}) as Pricing;

  const money = (name: keyof Pricing, label: string): FieldSpec => ({
    kind: 'text',
    name,
    label,
    type: 'number',
    step: '0.01',
    min: 0,
    defaultValue: values[name],
  });

  return (
    <EntityForm
      action={updateMerchantPricing}
      title={t.merchants.servicePricing}
      description={t.merchants.commercialTerms}
      fields={[
        { kind: 'hidden', name: 'id', value: merchantId },
        money('storage_per_cbm', 'Storage / m³'),
        money('receiving_per_unit', 'Receiving / unit'),
        money('pick', 'Pick / unit'),
        money('pack', 'Pack / order'),
        money('shipping', 'Shipping / order'),
        money('return_handling', 'Return handling'),
      ]}
      trigger={t.merchants.servicePricing}
      triggerIcon="pencil"
      triggerVariant="secondary"
      submitLabel={t.common.saveChanges}
      size="md"
    />
  );
}
