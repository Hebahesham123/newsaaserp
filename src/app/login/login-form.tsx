'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useI18n } from '@/i18n/provider';
import { signIn, type AuthState } from '@/lib/auth/actions';
import { Button, Field, Input, Notice } from '@/components/ui';

function SubmitButton() {
  const { t } = useI18n();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? t.auth.signingIn : t.auth.signIn}
    </Button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const { t } = useI18n();
  const [state, formAction] = useActionState<AuthState, FormData>(signIn, {});

  const errorMessage =
    state.error === 'accountLocked'
      ? t.auth.accountLocked
      : state.error === 'accountInactive'
        ? t.auth.accountInactive
        : state.error
          ? t.auth.invalidCredentials
          : null;

  return (
    <form action={formAction} className="rounded-card border border-border bg-surface p-6">
      <h2 className="text-sm font-semibold text-ink">{t.auth.signIn}</h2>
      <p className="mt-1 mb-5 text-sm text-ink-muted">{t.auth.signInSubtitle}</p>

      {errorMessage ? (
        <div className="mb-4">
          <Notice tone="danger">{errorMessage}</Notice>
        </div>
      ) : null}

      <input type="hidden" name="next" value={next} />

      <div className="space-y-4">
        <Field label={t.common.email}>
          <Input
            type="email"
            name="email"
            autoComplete="email"
            required
            dir="ltr"
            placeholder="you@company.com"
          />
        </Field>

        <Field label={t.auth.password}>
          <Input type="password" name="password" autoComplete="current-password" required dir="ltr" />
        </Field>

        <SubmitButton />
      </div>
    </form>
  );
}
