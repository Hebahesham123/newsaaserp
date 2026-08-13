import Link from 'next/link';
import { getDictionary } from '@/i18n/server';

export default async function ForbiddenPage() {
  const t = await getDictionary();

  return (
    <div className="flex min-h-screen items-center justify-center px-5">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold tracking-wide text-ink-subtle uppercase">403</p>
        <h1 className="mt-2 text-lg font-semibold text-ink">{t.errors.forbidden}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Your role does not include this screen. Ask an administrator if you need access.
        </p>
        <Link href="/" className="mt-6 inline-block text-sm text-brand hover:underline">
          {t.nav.dashboard}
        </Link>
      </div>
    </div>
  );
}
