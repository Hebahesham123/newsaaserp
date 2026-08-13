'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { dirFor, type Locale } from './config';
import { en, type Dictionary } from './dictionaries/en';
import { ar } from './dictionaries/ar';

const DICTIONARIES: Record<Locale, Dictionary> = { en, ar };

type I18nValue = {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  t: Dictionary;
  /** Locale-aware number formatting; Arabic uses Western digits for operational clarity. */
  formatNumber: (value: number) => string;
  formatDate: (value: string | Date | null | undefined) => string;
  formatDateTime: (value: string | Date | null | undefined) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => {
    const intlLocale = locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';

    const numberFormat = new Intl.NumberFormat(intlLocale);
    const dateFormat = new Intl.DateTimeFormat(intlLocale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
    const dateTimeFormat = new Intl.DateTimeFormat(intlLocale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    const toDate = (v: string | Date | null | undefined) => {
      if (!v) return null;
      const d = v instanceof Date ? v : new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    return {
      locale,
      dir: dirFor(locale),
      t: DICTIONARIES[locale],
      formatNumber: (v) => numberFormat.format(v),
      formatDate: (v) => {
        const d = toDate(v);
        return d ? dateFormat.format(d) : '—';
      },
      formatDateTime: (v) => {
        const d = toDate(v);
        return d ? dateTimeFormat.format(d) : '—';
      },
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
