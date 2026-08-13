'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { useI18n } from '@/i18n/provider';
import { createStore, type StoreFormState } from '../actions';
import { Button, Card, CardBody, Field, Input, Notice, Select } from '@/components/ui';
import type { ChannelPlatform } from '@/lib/supabase/database.types';

const PLATFORMS: ChannelPlatform[] = [
  'shopify',
  'woocommerce',
  'amazon',
  'noon',
  'custom_store',
  'mobile_app',
  'pos',
  'branch',
  'social_commerce',
  'manual',
  'wholesale',
  'other_marketplace',
];

function Submit() {
  const { t } = useI18n();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.common.loading : t.common.save}
    </Button>
  );
}

export function StoreForm({
  merchants,
  defaultMerchantId,
}: {
  merchants: { id: string; name: string; code: string }[];
  defaultMerchantId: string | null;
}) {
  const { t } = useI18n();
  const [state, formAction] = useActionState<StoreFormState, FormData>(createStore, {});
  const fe = state.fieldErrors ?? {};

  if (merchants.length === 0) {
    return (
      <Card>
        <CardBody>
          <Notice tone="warning" title={t.common.noResults}>
            A store cannot be created without a merchant (§2.13 rule 1).{' '}
            <Link href="/merchants/new" className="underline">
              {t.common.create} {t.merchants.title}
            </Link>
          </Notice>
        </CardBody>
      </Card>
    );
  }

  return (
    <form action={formAction}>
      <Card>
        <CardBody className="space-y-5">
          {state.error ? <Notice tone="danger">{state.error}</Notice> : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t.stores.merchant} error={fe.merchant_id}>
              <Select name="merchant_id" defaultValue={defaultMerchantId ?? merchants[0].id} required>
                {merchants.map((merchant) => (
                  <option key={merchant.id} value={merchant.id}>
                    {merchant.name} ({merchant.code})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t.stores.platform} error={fe.platform}>
              <Select name="platform" defaultValue="shopify" required>
                {PLATFORMS.map((platform) => (
                  <option key={platform} value={platform}>
                    {t.platform[platform]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t.common.code} error={fe.code} hint="Unique within your company">
              <Input name="code" required dir="ltr" placeholder="ACME-SHOP" />
            </Field>

            <Field label={t.common.name} error={fe.name}>
              <Input name="name" required />
            </Field>

            <Field label={t.stores.storeUrl} error={fe.store_url}>
              <Input name="store_url" type="url" dir="ltr" placeholder="https://shop.myshopify.com" />
            </Field>

            <Field label={t.common.currency} error={fe.currency}>
              <Input name="currency" defaultValue="EGP" maxLength={3} dir="ltr" />
            </Field>

            <Field label={t.common.country} error={fe.country}>
              <Input name="country" defaultValue="Egypt" />
            </Field>
          </div>

          <div className="flex items-center gap-2 border-t border-border pt-4">
            <Submit />
            <Link href="/stores">
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
