'use client';

import { useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Copy, Check } from 'lucide-react';
import { Button, Select, Input } from '@/components/ui';
import { EMPTY_STATE, type ActionState } from '@/lib/forms';
import { runBulkAction } from './bulk-actions';

/**
 * §1 Order Selection & Bulk Actions.
 *
 * The table inside this form is rendered on the server — badges, money, links
 * and every permission decision stay there. This component owns only the
 * selection, which is the one thing that genuinely needs the browser.
 *
 * Selection is read from the DOM rather than mirrored into React state. The
 * checkboxes are already the source of truth, and a parallel array of ids would
 * only be something to keep in sync and eventually get wrong — the count is
 * recomputed from the form on every change, and the ids are submitted by the
 * form itself.
 */

export type BulkOption = {
  value: string;
  label: string;
  /** Needs a target user. */
  needsAssignee?: boolean;
  /** Needs a tag to add. */
  needsTag?: boolean;
  danger?: boolean;
};

export function OrderSelectionForm({
  children,
  options,
  assignees,
  labels,
}: {
  children: ReactNode;
  options: BulkOption[];
  assignees: { id: string; name: string }[];
  labels: {
    selected: string;
    bulkActions: string;
    apply: string;
    assignedTo: string;
    tag: string;
  };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [count, setCount] = useState(0);
  const [op, setOp] = useState('');
  const [pending, startTransition] = useTransition();

  const recount = () => {
    const form = formRef.current;
    if (!form) return;
    setCount(form.querySelectorAll<HTMLInputElement>('input[name="orderId"]:checked').length);
  };

  const toggleAll = (checked: boolean) => {
    const form = formRef.current;
    if (!form) return;
    form
      .querySelectorAll<HTMLInputElement>('input[name="orderId"]')
      .forEach((box) => {
        box.checked = checked;
      });
    recount();
  };

  const selected = options.find((option) => option.value === op);

  const submit = () => {
    const form = formRef.current;
    if (!form || !op) return;

    const formData = new FormData(form);
    formData.set('op', op);

    startTransition(async () => {
      const result: ActionState = await runBulkAction(EMPTY_STATE, formData);

      // A bulk result is usually partial, so the message carries both halves
      // and a refusal is information rather than a failure.
      if (result.error) toast.error(result.error);
      else if (result.message) toast.success(result.message);

      toggleAll(false);
      setOp('');
    });
  };

  return (
    <form ref={formRef} onChange={recount}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            className="size-4 rounded border-border"
            onChange={(event) => toggleAll(event.currentTarget.checked)}
            aria-label={labels.bulkActions}
          />
          <span className="tnum">
            {count} {labels.selected}
          </span>
        </label>

        {count > 0 ? (
          <>
            <Select
              value={op}
              onChange={(event) => setOp(event.currentTarget.value)}
              aria-label={labels.bulkActions}
              className="w-auto"
            >
              <option value="">{labels.bulkActions}</option>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>

            {selected?.needsAssignee ? (
              <Select name="assigned_to" aria-label={labels.assignedTo} className="w-auto">
                <option value="">{labels.assignedTo}</option>
                {assignees.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </Select>
            ) : null}

            {selected?.needsTag ? (
              <Input name="tag" placeholder={labels.tag} className="w-40" />
            ) : null}

            <Button
              type="button"
              variant={selected?.danger ? 'danger' : 'primary'}
              size="sm"
              onClick={submit}
              disabled={!op || pending}
            >
              {labels.apply}
            </Button>
          </>
        ) : null}
      </div>

      {children}
    </form>
  );
}

/**
 * §2 Quick Actions — copy the order number.
 *
 * Separate from the row link because copying is the commonest thing anyone does
 * with an order number and making them select the text by hand is a small tax
 * paid hundreds of times a day.
 */
export function CopyOrderNumber({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      // Long enough to notice, short enough that the row does not stay marked.
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not reach the clipboard.');
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      aria-label={label}
      className="rounded p-1 text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink"
    >
      {copied ? (
        <Check className="size-3.5 text-success" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
    </button>
  );
}

/** One row's checkbox. Plain, named, and submitted by the surrounding form. */
export function RowCheckbox({ id, label }: { id: string; label: string }) {
  return (
    <input
      type="checkbox"
      name="orderId"
      value={id}
      aria-label={label}
      className="size-4 rounded border-border"
    />
  );
}
