export const THEMES = ['dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

/** Dark is the product default — see the rationale in globals.css. */
export const DEFAULT_THEME: Theme = 'dark';
export const THEME_COOKIE = 'green-erp-theme';

export function isTheme(value: string | undefined | null): value is Theme {
  return value === 'dark' || value === 'light';
}
