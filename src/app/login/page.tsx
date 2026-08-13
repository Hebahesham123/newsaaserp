import { getDictionary, getLocale } from '@/i18n/server';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in — Green ERP' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const t = await getDictionary();
  const locale = await getLocale();
  const { next } = await searchParams;

  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-lg font-semibold text-ink">{t.app.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t.app.tagline}</p>
        </div>

        {configured ? (
          <LoginForm next={next ?? '/'} />
        ) : (
          <div className="rounded-card border border-border bg-surface p-5">
            <h2 className="text-sm font-semibold text-ink">{t.setup.title}</h2>
            <p className="mt-2 text-sm text-ink-muted">{t.setup.body}</p>
            <ol className="mt-4 space-y-2 text-sm text-ink-muted">
              <li className="flex gap-2">
                <span className="text-ink-subtle tnum">1.</span>
                {t.setup.step1}
              </li>
              <li className="flex gap-2">
                <span className="text-ink-subtle tnum">2.</span>
                {t.setup.step2}
              </li>
              <li className="flex gap-2">
                <span className="text-ink-subtle tnum">3.</span>
                {t.setup.step3}
              </li>
            </ol>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-ink-subtle" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
          {t.app.name} · {t.app.tagline}
        </p>
      </div>
    </div>
  );
}
