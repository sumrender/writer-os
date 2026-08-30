/**
 * Shared whole-name occurrence search for chapter-text scans
 * (`bible-graph.ts` for importance counts; `bible-locations.ts` for
 * co-occurrence derivation). One definition so the letter-boundary,
 * regex-metachar-safe discipline stays in lockstep across the two
 * derivations (CODING_STANDARDS.md §2).
 */

/** Escapes a name for exact literal use inside a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Case-sensitive whole-name occurrence regex with ASCII-letter boundaries on
 * both sides: a name inside a longer word is not an occurrence. Apostrophes,
 * digits, spaces, and punctuation are non-letters, so a name like
 * `"McDougal's Cave"` matches as a literal phrase inside `"McDougal's caves"`
 * only by the trailing letter boundary, not the apostrophe.
 *
 * The regex carries the `g` flag. When reusing it across calls, ALWAYS
 * allocate a fresh instance — `.test()` advances `lastIndex`, so a shared
 * regex from a previous hit would zero the next call's match attempt.
 */
export function namePattern(name: string): RegExp {
  return new RegExp(`(?<![A-Za-z])${escapeRegExp(name)}(?![A-Za-z])`, "g");
}
