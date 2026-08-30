/**
 * Whole-name matching over text (issue #15): the single definition of what
 * counts as a name occurrence in prose — case-sensitive, whole name, letter
 * boundaries on both sides. Every derivation that scans text for entity
 * names (graph importance counting, character mention ordinals) matches
 * through this one pattern so "mentioned" never means two things.
 */

/** Escapes a name for exact literal use inside a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A fresh case-sensitive whole-name pattern for exact literal use. */
export function wholeNameRegExp(name: string): RegExp {
  return new RegExp(`(?<![A-Za-z])${escapeRegExp(name)}(?![A-Za-z])`);
}
