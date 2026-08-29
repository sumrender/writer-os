import { existsSync, readFileSync } from "node:fs";

/**
 * Whether a live run can reach Agnes: the API key may be exported in the
 * server environment or set in the benchmarks .env the CLI loads. Only a
 * boolean ever leaves this module — the key itself must not cross into the
 * browser (CODING_STANDARDS §1.5, and the obvious secret hygiene).
 */

function keyInEnvFile(envFile: string, name: string): boolean {
  if (!existsSync(envFile)) return false;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (match?.[1] !== name) continue;
    const value = (match[2] ?? "").trim();
    const unquoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
        ? value.slice(1, -1)
        : value;
    if (unquoted.length > 0) return true;
  }
  return false;
}

export function agnesCredentialsConfigured(envFile: string): boolean {
  const fromEnv = process.env["AGNES_API_KEY"];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) return true;
  return keyInEnvFile(envFile, "AGNES_API_KEY");
}
