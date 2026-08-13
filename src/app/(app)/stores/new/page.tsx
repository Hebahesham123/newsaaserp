import { requirePermission } from '@/lib/auth/session';
import { getDictionary } from '@/i18n/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { Notice, PageHeader } from '@/components/ui';
import { StoreForm } from './store-form';

export default async function NewStorePage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string }>;
}) {
  await requirePermission('stores.create');
  const t = await getDictionary();
  const { merchant } = await searchParams;

  const supabase = await createServerSupabase();
  const { data: merchants } = await supabase
    .from('merchants')
    .select('id, name, code')
    .is('archived_at', null)
    .order('name');

  return (
    <>
      <PageHeader title={`${t.common.create} — ${t.stores.title}`} subtitle={t.stores.subtitle} />

      <div className="max-w-3xl space-y-4">
        <Notice tone="info" title={t.stores.providerMock}>
          {t.stores.mockNotice}
        </Notice>

        <StoreForm merchants={merchants ?? []} defaultMerchantId={merchant ?? null} />
      </div>
    </>
  );
}
