/**
 * Deterministic JSON encoding used wherever arbitrary data becomes an
 * identity: cache keys, fact-content keys. Object keys sort; array order is
 * preserved; `undefined` collapses to null like JSON.stringify would drop it.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
