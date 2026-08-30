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

const SNIPPET_MAX = 160;

/** Truncated raw-payload snippet attached to every trust-boundary rejection. */
function snippet(raw: unknown): string {
  let text: string;
  try {
    text = raw === undefined ? "undefined" : (JSON.stringify(raw) ?? String(raw));
  } catch {
    text = String(raw);
  }
  return text.slice(0, SNIPPET_MAX);
}

/**
 * The uniform rejection style for hand-authored payload validators: where it
 * failed, why, and a `near:` raw-payload snippet for diagnosability from run
 * logs alone.
 */
export function failSection(where: string, problem: string, raw: unknown): never {
  throw new Error(`${where}: ${problem} near: ${snippet(raw)}`);
}
