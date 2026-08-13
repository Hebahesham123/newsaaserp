'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { useI18n } from '@/i18n/provider';
import { createMerchant, type MerchantFormState } from '../actions';
import { Button, Card, CardBody, Field, Input, Notice, Select } from '@/components/ui';

const OPERATING_MODELS = [
  'own_store',
  'multi_store',
  'fulfillment_center',
  'operations_only',
  'marketplace',
] as const;

const STATUSES = [
  'lead',
  'contracting',
  'onboarding',
  'ready_for_go_live',
  'active',
  'on_hold',
] as const;

function Submit() {
  const { t } = useI18n();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.common.loading : t.common.save}
    </Button>
  );
}

export function MerchantForm() {
  const { t } = useI18n();
  const [state, formAction] = useActionState<MerchantFormState, FormData>(createMerchant, {});
  const fe = state.fieldErrors ?? {};

  return (
    <form action={formAction}>
      <Card>
        <CardBody className="space-y-5">
          {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t.common.code} error={fe.code} hint="Unique within your company">
              <Input name="code" required dir="ltr" placeholder="ACME" />
            </Field>

            <Field label={t.common.name} error={fe.name}>
              <Input name="name" required />
            </Field>

            <Field label={t.merchants.merchantType} error={fe.trade_name}>
              <Input name="trade_name" placeholder={t.companies.tradeName} />
            </Field>

            <Field label={t.common.email} error={fe.email}>
              <Input name="email" type="email" dir="ltr" />
            </Field>

            <Field label={t.common.phone} error={fe.phone}>
              <Input name="phone" dir="ltr" />
            </Field>

            <Field label={t.common.country} error={fe.country}>
              <Input name="country" />
            </Field>

            <Field label={t.common.currency} error={fe.currency}>
              <Input name="currency" defaultValue="EGP" maxLength={3} dir="ltr" />
            </Field>

            <Field label={t.companies.operatingModel} error={fe.operating_model}>
              <Select name="operating_model" defaultValue="own_store">
                {OPERATING_MODELS.map((model) => (
                  <option key={model} value={model}>
                    {t.operatingModel[model]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t.common.status} error={fe.status}>
              <Select name="status" defaultValue="onboarding">
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t.status[status]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t.merchants.settlementCycle} error={fe.settlement_cycle}>
              <Select name="settlement_cycle" defaultValue="weekly">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </Select>
            </Field>

            <Field label={t.merchants.commission} error={fe.commission_percentage}>
              <Input name="commission_percentage" type="number" step="0.001" min="0" max="100" dir="ltr" />
            </Field>
          </div>

          <div className="flex items-center gap-2 border-t border-border pt-4">
            <Submit />
            <Link href="/merchants">
              <Button variant="secondary" type="button">
                {t.common.cancel}
              </Button>
            </Link>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
