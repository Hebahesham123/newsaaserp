import 'server-only';

import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from './config';
import { en, type Dictionary } from './dictionaries/en';
import { ar } from './dictionaries/ar';

const DICTIONARIES: Record<Locale, Dictionary> = { en, ar };

/**
 * Resolves the active locale for this request.
 *
 * Preference order: explicit cookie → default. The user's stored `locale`
 * (§2.5.2) is written to the cookie at sign-in, so the two stay in step
 * without an extra query on every render.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getDictionary(): Promise<Dictionary> {
  return DICTIONARIES[await getLocale()];
}

export function dictionaryFor(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}
