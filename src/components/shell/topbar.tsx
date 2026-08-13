'use client';

import { Languages, LogOut } from 'lucide-react';
import { useI18n } from '@/i18n/provider';
import { LOCALE_LABELS, type Locale } from '@/i18n/config';
import { setLocale, signOut } from '@/lib/auth/actions';

export function Topbar({
  userName,
  companyName,
  roleSummary,
}: {
  userName: string;
  companyName: string | null;
  roleSummary: string;
}) {
  const { t, locale } = useI18n();
  const otherLocale: Locale = locale === 'ar' ? 'en' : 'ar';

  return (
    <header className="flex items-center justify-between gap-4 border-b border-border bg-surface px-5 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink">{companyName ?? t.app.name}</p>
        <p className="truncate text-xs text-ink-subtle">{roleSummary}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <form action={setLocale}>
          <input type="hidden" name="locale" value={otherLocale} />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
            title={t.common.language}
          >
            <Languages className="size-4" aria-hidden />
            {LOCALE_LABELS[otherLocale]}
          </button>
        </form>

        <span className="mx-1 hidden text-sm text-ink-muted sm:inline">{userName}</span>

        <form action={signOut}>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <LogOut className="size-4 flip-icon" aria-hidden />
            <span className="hidden sm:inline">{t.common.signOut}</span>
          </button>
        </form>
      </div>
    </header>
  );
}
