import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalJson } from "./canonical-json.js";
import { silentLogger, type Logger } from "./logger.js";

/**
 * Verdict caches keyed by the hash of a canonical encoding of the judge
 * input (docs/TESTING.md §9): repeated identical calls are free, and cache
 * files live only under gitignored run-output paths.
 */

export interface VerdictCache {
  get(key: string): boolean | undefined;
  set(key: string, verdict: boolean): void;
}

export function hashVerdictInput(operation: string, payload: unknown): string {
  return createHash("sha256")
    .update(canonicalJson({ operation, payload }))
    .digest("hex");
}

export class MemoryVerdictCache implements VerdictCache {
  readonly #entries = new Map<string, boolean>();

  get(key: string): boolean | undefined {
    return this.#entries.get(key);
  }

  set(key: string, verdict: boolean): void {
    this.#entries.set(key, verdict);
  }
}

export class FileVerdictCache implements VerdictCache {
  readonly #path: string;
  readonly #entries = new Map<string, boolean>();
  readonly #log: Logger;

  /** A missing or malformed cache file simply starts empty — a cache may
   * never make a run fail. */
  constructor(path: string, log: Logger = silentLogger) {
    this.#path = path;
    this.#log = log;
    this.#load();
  }

  get(key: string): boolean | undefined {
    return this.#entries.get(key);
  }

  set(key: string, verdict: boolean): void {
    this.#entries.set(key, verdict);
    this.#flush();
  }

  #load(): void {
    if (!existsSync(this.#path)) {
      this.#log.info(`verdict cache: empty (no file at ${this.#path})`);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.#path, "utf8"));
    } catch {
      this.#log.info(`verdict cache: malformed file at ${this.#path}, starting empty`);
      return;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "boolean") this.#entries.set(key, value);
    }
    this.#log.info(`verdict cache: loaded ${this.#entries.size} entr(ies) from ${this.#path}`);
  }

  #flush(): void {
    mkdirSync(dirname(this.#path), { recursive: true });
    writeFileSync(
      this.#path,
      `${JSON.stringify(Object.fromEntries(this.#entries), null, 2)}\n`,
    );
  }
}
