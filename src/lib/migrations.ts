/**
 * Detects "this table does not exist yet".
 *
 * The catalog screens ship with migrations 0010/0011, which an operator applies
 * separately. Until then a query for `products` fails, and a blank error page
 * would leave someone guessing. Every catalog page checks for this and renders
 * an instruction instead.
 */
export function isMissingRelation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  // 42P01 = undefined_table from Postgres; PGRST205 = PostgREST's schema cache miss.
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /relation .* does not exist|could not find the table/i.test(error.message ?? '');
}

/** The migrations a screen depends on, for the message shown when they are absent. */
export const CATALOG_MIGRATIONS = '0010_catalog / 0011_catalog_rls';
