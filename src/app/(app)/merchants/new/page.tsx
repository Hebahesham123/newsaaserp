import { requirePermission } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { PageHeader } from '@/components/ui';
import { MerchantForm } from './merchant-form';

export default async function NewMerchantPage() {
  await requirePermission('merchants.create');
  const t = await getDictionary();

  return (
    <>
      <PageHeader title={`${t.common.create} — ${t.merchants.title}`} subtitle={t.merchants.subtitle} />
      <div className="max-w-3xl">
        <MerchantForm />
      </div>
    </>
  );
}
