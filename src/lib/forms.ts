import type { z } from 'zod';

/**
 * The single shape every mutating server action returns.
 *
 * `ok` is what the client dialog watches to close itself and raise a toast, so
 * an action that succeeds silently must still set it.
 */
export type ActionState = {
  ok?: boolean;
  /** Success text for the toast. */
  message?: string;
  /** Whole-form failure — a constraint, a permission, a database error. */
  error?: string;
  /** Per-field validation messages, keyed by input name. */
  fieldErrors?: Record<string, string>;
};

export const EMPTY_STATE: ActionState = {};

/** Flattens a Zod issue list into the `fieldErrors` shape the form renders. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    // First message per field wins; later ones are usually less specific.
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

/** '' → null, so an emptied optional input clears the column instead of storing ''. */
export function nullIfBlank(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Numeric input that may legitimately be left empty. */
export function numberOrNull(value: unknown): number | null {
  const text = nullIfBlank(value);
  if (text === null) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** An unchecked checkbox submits nothing at all, which is not the same as false. */
export function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) != null;
}

/** All values for a repeated input — checkbox groups and multi-selects. */
export function multi(formData: FormData, name: string): string[] {
  return formData.getAll(name).map(String).filter(Boolean);
}

/**
 * Translates the Postgres errors these forms can actually provoke into
 * something a user can act on. Anything else is passed through: a surprising
 * database error should be visible, not swallowed behind a generic message.
 */
export function describeDbError(
  error: { code?: string; message: string },
  hints: { uniqueField?: string; uniqueMessage?: string } = {},
): ActionState {
  switch (error.code) {
    case '23505': // unique_violation
      return hints.uniqueField
        ? { fieldErrors: { [hints.uniqueField]: hints.uniqueMessage ?? 'This value is already taken.' } }
        : { error: hints.uniqueMessage ?? 'A record with these details already exists.' };
    case '23503': // foreign_key_violation
      return { error: 'A referenced record no longer exists. Reload the page and try again.' };
    case '23514': // check_violation — the spec's business rules surface here
      return { error: error.message.replace(/^new row for relation "[^"]+" violates /, '') };
    case '42501': // insufficient_privilege — an RLS policy refused the write
      return { error: 'Your permissions do not allow this change.' };
    case 'PGRST116':
      return { error: 'Record not found, or you do not have access to it.' };
    default:
      return { error: error.message };
  }
}
