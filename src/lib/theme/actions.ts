'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { isTheme, THEME_COOKIE } from './config';

/** Persists the viewer's theme choice for a year. */
export async function setTheme(formData: FormData): Promise<void> {
  const theme = String(formData.get('theme') ?? '');
  if (!isTheme(theme)) return;

  const store = await cookies();
  store.set(THEME_COOKIE, theme, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' });

  revalidatePath('/', 'layout');
}
