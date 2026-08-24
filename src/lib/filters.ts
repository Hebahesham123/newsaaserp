/**
 * Narrows a query-string value to one of a known set.
 *
 * Filters arrive as `string | undefined` from the URL but the typed Supabase
 * client wants the column's enum. Anything unrecognised becomes `undefined`, so
 * a hand-edited URL degrades to "no filter" instead of a failed query.
 */
export function pickFilter<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (!value) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Escapes a search term for a PostgREST `or(...)` filter list. */
export function searchTerm(value: string | undefined): string | null {
  if (!value) return null;
  // Commas and parentheses would break out of the or() argument list.
  const cleaned = value.trim().replace(/[,()*]/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : null;
}
