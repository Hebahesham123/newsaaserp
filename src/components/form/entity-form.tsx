'use client';

import { useId, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Plus, Pencil } from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
} from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';
import { EMPTY_STATE, type ActionState } from '@/lib/forms';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* Field specification                                                        */
/* -------------------------------------------------------------------------- */

type Option = { value: string; label: string };

export type FieldSpec =
  | {
      kind: 'text';
      name: string;
      label: string;
      type?: 'text' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'time' | 'password';
      defaultValue?: string | number | null;
      placeholder?: string;
      hint?: string;
      required?: boolean;
      step?: string;
      min?: number;
      max?: number;
      dir?: 'ltr' | 'rtl';
      full?: boolean;
      readOnly?: boolean;
    }
  | {
      kind: 'select';
      name: string;
      label: string;
      options: Option[];
      defaultValue?: string | null;
      placeholder?: string;
      hint?: string;
      required?: boolean;
      full?: boolean;
    }
  | {
      kind: 'textarea';
      name: string;
      label: string;
      defaultValue?: string | null;
      hint?: string;
      required?: boolean;
      full?: boolean;
      rows?: number;
    }
  | {
      kind: 'checkbox';
      name: string;
      label: string;
      defaultChecked?: boolean;
      hint?: string;
      full?: boolean;
    }
  | {
      kind: 'multi';
      name: string;
      label: string;
      options: Option[];
      selected?: string[];
      hint?: string;
      columns?: 1 | 2 | 3;
      full?: boolean;
    }
  | { kind: 'hidden'; name: string; value: string }
  | { kind: 'section'; label: string };

/* -------------------------------------------------------------------------- */
/* Field renderer                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Keyed by position rather than by field name: §3.4 variant option axes submit
 * as repeated `option_name` / `option_value` inputs, so names are legitimately
 * duplicated within one form and cannot serve as React keys.
 */
function renderField(spec: FieldSpec, errors: Record<string, string> | undefined, index: number) {
  if (spec.kind === 'hidden') {
    return <input key={index} type="hidden" name={spec.name} value={spec.value} />;
  }

  if (spec.kind === 'section') {
    return (
      <p
        key={index}
        className="col-span-full mt-2 border-b border-border pb-1.5 text-xs font-semibold tracking-wide text-ink-subtle uppercase first:mt-0"
      >
        {spec.label}
      </p>
    );
  }

  const error = errors?.[spec.name];
  const wrapper = 'full' in spec && spec.full ? 'col-span-full' : undefined;

  if (spec.kind === 'checkbox') {
    return (
      <div key={index} className={wrapper}>
        <Checkbox name={spec.name} label={spec.label} hint={spec.hint} defaultChecked={spec.defaultChecked} />
        {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : null}
      </div>
    );
  }

  if (spec.kind === 'multi') {
    return (
      <div key={index} className={wrapper}>
        <Field label={spec.label} hint={spec.hint} error={error}>
          <CheckboxGroup
            name={spec.name}
            options={spec.options}
            selected={spec.selected}
            columns={spec.columns ?? 2}
          />
        </Field>
      </div>
    );
  }

  if (spec.kind === 'select') {
    return (
      <div key={index} className={wrapper}>
        <Field label={spec.label} hint={spec.hint} error={error} required={spec.required}>
          <Select name={spec.name} defaultValue={spec.defaultValue ?? ''} required={spec.required}>
            <option value="">{spec.placeholder ?? '—'}</option>
            {spec.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    );
  }

  if (spec.kind === 'textarea') {
    return (
      <div key={index} className={cn(wrapper ?? 'col-span-full')}>
        <Field label={spec.label} hint={spec.hint} error={error} required={spec.required}>
          <Textarea
            name={spec.name}
            defaultValue={spec.defaultValue ?? ''}
            required={spec.required}
            rows={spec.rows}
          />
        </Field>
      </div>
    );
  }

  return (
    <div key={index} className={wrapper}>
      <Field label={spec.label} hint={spec.hint} error={error} required={spec.required}>
        <Input
          name={spec.name}
          type={spec.type ?? 'text'}
          defaultValue={spec.defaultValue ?? ''}
          placeholder={spec.placeholder}
          required={spec.required}
          step={spec.step}
          min={spec.min}
          max={spec.max}
          dir={spec.dir}
          readOnly={spec.readOnly}
        />
      </Field>
    </div>
  );
}

function SubmitButton({ label, pending }: { label: string; pending: boolean }) {
  const { t } = useI18n();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.common.saving : label}
    </Button>
  );
}

/* -------------------------------------------------------------------------- */
/* Dialog-hosted form                                                         */
/* -------------------------------------------------------------------------- */

export type EntityFormProps = {
  /** Server action following the ActionState contract. */
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  title: string;
  description?: string;
  fields: FieldSpec[];
  /** Text of the button that opens the dialog. */
  trigger: string;
  triggerIcon?: 'plus' | 'pencil' | 'none';
  triggerVariant?: 'primary' | 'secondary' | 'ghost' | 'subtle';
  triggerSize?: 'sm' | 'md';
  submitLabel?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Rendered above the fields — used for warnings and context. */
  banner?: ReactNode;
};

/**
 * A create/edit form in a modal, driven by a field spec.
 *
 * Every entity in the app uses this rather than a bespoke form, so validation
 * display, pending state, error surfacing and success toasts behave identically
 * everywhere. The dialog closes only when the action reports `ok`, which means
 * a failed submit keeps the user's input on screen.
 */
export function EntityForm({
  action,
  title,
  description,
  fields,
  trigger,
  triggerIcon = 'plus',
  triggerVariant = 'primary',
  triggerSize = 'md',
  submitLabel,
  size = 'md',
  banner,
}: EntityFormProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ActionState>(EMPTY_STATE);
  const [pending, startTransition] = useTransition();
  const formId = useId();

  /**
   * The action is awaited here rather than through useActionState so success
   * handling — toast, then close — happens in the submit handler. Closing from
   * an effect that watches the result would be a render-triggered state update.
   */
  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await action(EMPTY_STATE, formData);
      setState(result);

      if (result.ok) {
        toast.success(result.message ?? t.common.saved);
        setOpen(false);
      } else if (result.error) {
        toast.error(result.error);
      }
    });
  }

  function openDialog() {
    // Clear any errors from a previous attempt so the form opens clean.
    setState(EMPTY_STATE);
    setOpen(true);
  }

  const Icon = triggerIcon === 'plus' ? Plus : triggerIcon === 'pencil' ? Pencil : null;

  return (
    <>
      <Button variant={triggerVariant} size={triggerSize} onClick={openDialog}>
        {Icon ? <Icon className="size-4" aria-hidden /> : null}
        {trigger}
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        size={size}
      >
        {/*
          Fields and actions share one <form>. The action row is sticky to the
          bottom of the scroll area so Save stays reachable on a long form
          without splitting the inputs across two elements.
        */}
        <form action={submit} id={formId}>
          {state.error ? (
            <div className="mb-4">
              <Notice tone="danger">{state.error}</Notice>
            </div>
          ) : null}
          {banner ? <div className="mb-4">{banner}</div> : null}

          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {fields.map((spec, index) => renderField(spec, state.fieldErrors, index))}
          </div>

          <div className="sticky bottom-0 -mx-5 -mb-4 mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <SubmitButton label={submitLabel ?? t.common.save} pending={pending} />
          </div>
        </form>
      </Dialog>
    </>
  );
}
