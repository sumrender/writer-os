/**
 * Shared rejection formatting for Story Bible section validators (issue #14
 * discipline, reused by the World slice in issue #16): every trust-boundary
 * rejection names its section, states the problem, and attaches a truncated
 * `near:` snippet of the raw payload so the synthesis retry can show the
 * model exactly what it got wrong.
 */

const SNIPPET_MAX = 160;

function snippet(raw: unknown): string {
  let text: string;
  try {
    text = raw === undefined ? "undefined" : (JSON.stringify(raw) ?? String(raw));
  } catch {
    text = String(raw);
  }
  return text.slice(0, SNIPPET_MAX);
}

export function failSection(where: string, problem: string, raw: unknown): never {
  throw new Error(`${where}: ${problem} near: ${snippet(raw)}`);
}
