import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import { getLocale } from '@/i18n/server';
import { dirFor } from '@/i18n/config';
import { I18nProvider } from '@/i18n/provider';
import { getTheme } from '@/lib/theme/server';
import './globals.css';

export const metadata: Metadata = {
  title: 'Green ERP — E-Commerce Operations & Fulfillment',
  description:
    'Centralized platform for e-commerce operations: orders, confirmation, inventory, fulfillment, shipping, collections and profitability.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [locale, theme] = await Promise.all([getLocale(), getTheme()]);

  // `dir` is set on <html> so every logical Tailwind utility (ms-, pe-, start-,
  // end-) mirrors automatically. Arabic is the default (§1.9). `data-theme` is
  // resolved server-side so the correct palette is present on first paint.
  return (
    <html lang={locale} dir={dirFor(locale)} data-theme={theme} suppressHydrationWarning>
      <body className="min-h-full antialiased">
        <I18nProvider locale={locale}>{children}</I18nProvider>
        <Toaster
          position={dirFor(locale) === 'rtl' ? 'bottom-left' : 'bottom-right'}
          theme={theme}
          richColors
          closeButton
        />
      </body>
    </html>
  );
}
