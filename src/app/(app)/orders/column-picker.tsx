'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Columns3 } from 'lucide-react';
import { Button } from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';
import { EMPTY_STATE } from '@/lib/forms';
import { saveColumnPreference, resetColumnPreference } from './preferences';

/**
 * §6 Customize Columns.
 *
 * The list is what the server decided this person may see, so a column their
 * role forbids is absent rather than disabled — the brief is specific that it
 * should not appear here at all, and a greyed-out row still tells you the
 * column exists.
 */
export function ColumnPicker({
  columns,
  labels,
}: {
  columns: { key: string; label: string; checked: boolean }[];
  labels: {
    customizeColumns: string;
    columnsHint: string;
    apply: string;
    resetToDefault: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await saveColumnPreference(EMPTY_STATE, formData);
      if (result.error) toast.error(result.error);
      else {
        toast.success(result.message ?? labels.apply);
        setOpen(false);
      }
    });
  };

  const reset = () => {
    startTransition(async () => {
      const result = await resetColumnPreference();
      if (result.error) toast.error(result.error);
      else {
        toast.success(result.message ?? labels.resetToDefault);
        setOpen(false);
      }
    });
  };

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Columns3 className="me-1.5 size-4" aria-hidden />
        {labels.customizeColumns}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={labels.customizeColumns}
        description={labels.columnsHint}
        size="sm"
      >
        <form onSubmit={submit}>
          <div className="max-h-[60vh] space-y-1 overflow-y-auto">
            {columns.map((column) => (
              <label
                key={column.key}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-surface-muted"
              >
                <input
                  type="checkbox"
                  name="column"
                  value={column.key}
                  defaultChecked={column.checked}
                  className="size-4 rounded border-border"
                />
                <span className="text-ink">{column.label}</span>
              </label>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={pending}>
              {labels.resetToDefault}
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {labels.apply}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
