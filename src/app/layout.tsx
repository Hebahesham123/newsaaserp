import type { Metadata } from 'next';
import { getLocale } from '@/i18n/server';
import { dirFor } from '@/i18n/config';
import { I18nProvider } from '@/i18n/provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Green ERP — E-Commerce Operations & Fulfillment',
  description:
    'Centralized platform for e-commerce operations: orders, confirmation, inventory, fulfillment, shipping, collections and profitability.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();

  // `dir` is set on <html> so every logical Tailwind utility (ms-, pe-, start-,
  // end-) mirrors automatically. Arabic is the default (§1.9).
  return (
    <html lang={locale} dir={dirFor(locale)} suppressHydrationWarning>
      <body className="min-h-full antialiased">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
