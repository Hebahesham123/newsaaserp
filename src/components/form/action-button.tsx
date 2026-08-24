'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Archive, Check, KeyRound, RefreshCw, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { EMPTY_STATE, type ActionState } from '@/lib/forms';

const ICONS = {
  archive: Archive,
  restore: RotateCcw,
  sync: RefreshCw,
  approve: Check,
  reject: X,
  key: KeyRound,
  none: null,
} as const;

/**
 * One-click server action with feedback.
 *
 * Everything destructive or state-changing in a table row goes through this so
 * the confirm prompt, pending state, toast and error surface behave the same
 * everywhere. Errors are toasted rather than thrown: a failed archive should
 * explain itself, not replace the page with an error boundary.
 */
export function ActionButton({
  action,
  fields,
  label,
  icon = 'none',
  variant = 'ghost',
  size = 'sm',
  confirm,
  iconOnly,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fields?: Record<string, string>;
  label: string;
  icon?: keyof typeof ICONS;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
  size?: 'sm' | 'md';
  confirm?: string;
  iconOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const Icon = ICONS[icon];

  // Awaited in the submit handler rather than watched from an effect, so the
  // feedback happens once per click instead of on every re-render.
  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await action(EMPTY_STATE, formData);

      if (result.ok) toast.success(result.message ?? 'Done');
      else if (result.error) toast.error(result.error);
      else if (result.fieldErrors) toast.error(Object.values(result.fieldErrors)[0]);
    });
  }

  return (
    <form action={submit} className="inline-flex">
      {Object.entries(fields ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button
        type="submit"
        variant={variant}
        size={size}
        disabled={pending}
        title={iconOnly ? label : undefined}
        aria-label={iconOnly ? label : undefined}
        // A destructive or irreversible action confirms before the form submits.
        onClick={
          confirm
            ? (event) => {
                if (!window.confirm(confirm)) event.preventDefault();
              }
            : undefined
        }
      >
        {Icon ? (
          <Icon
            className={pending && icon === 'sync' ? 'size-4 animate-spin' : 'size-4'}
            aria-hidden
          />
        ) : null}
        {iconOnly ? null : label}
      </Button>
    </form>
  );
}
