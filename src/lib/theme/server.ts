import 'server-only';

import { cookies } from 'next/headers';
import { DEFAULT_THEME, isTheme, THEME_COOKIE, type Theme } from './config';

/**
 * Resolves the theme for this request.
 *
 * Read on the server and written onto <html data-theme> so the first paint is
 * already correct. A client-side toggle would flash the default theme before
 * hydration, which on a dark-first product is a full-screen white flash.
 */
export async function getTheme(): Promise<Theme> {
  const store = await cookies();
  const value = store.get(THEME_COOKIE)?.value;
  return isTheme(value) ? value : DEFAULT_THEME;
}
