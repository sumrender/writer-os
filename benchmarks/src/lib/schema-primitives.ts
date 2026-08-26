/**
 * Shared JSON/YAML schema-validation primitives (docs/TESTING.md schema
 * sections): the small set of type guards every hand-authored fixture
 * validator in this workspace needs at its trust boundary. One definition
 * here instead of re-derived per validator (CODING_STANDARDS.md §2).
 */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** Lowercase, dash-separated identifier used for every hand-authored id field. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
