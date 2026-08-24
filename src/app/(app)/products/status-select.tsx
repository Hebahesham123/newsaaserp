'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { useI18n } from '@/i18n/provider';
import { Select } from '@/components/ui';
import { EMPTY_STATE } from '@/lib/forms';
import { setProductStatus } from './actions';

const PRODUCT_STATUSES = [
  'draft', 'under_review', 'active', 'inactive', 'unavailable', 'out_of_stock',
  'temporarily_suspended', 'discontinued', 'archived', 'sync_error', 'unmapped',
] as const;

/**
 * §3.12 "Change product status" as an inline control.
 *
 * Status is its own permission because activating a listing is what makes it
 * sellable, so it is separated from the edit form rather than buried in it.
 * Rule 11 (no activation without a price) is enforced in the database; its
 * message is surfaced through the toast unchanged.
 */
export function StatusSelect({ id, status }: { id: string; status: string }) {
  const { t } = useI18n();
  const [pending, startTransition] = useTransition();

  function change(next: string) {
    if (next === status) return;

    startTransition(async () => {
      const formData = new FormData();
      formData.set('id', id);
      formData.set('status', next);

      const result = await setProductStatus(EMPTY_STATE, formData);
      if (result.ok) toast.success(result.message ?? t.common.saved);
      else if (result.error) toast.error(result.error);
    });
  }

  return (
    <Select
      value={status}
      disabled={pending}
      aria-label={t.common.status}
      className="w-auto min-w-32 py-1 text-xs"
      onChange={(event) => change(event.target.value)}
    >
      {PRODUCT_STATUSES.map((value) => (
        <option key={value} value={value}>
          {t.productStatus[value]}
        </option>
      ))}
    </Select>
  );
}
