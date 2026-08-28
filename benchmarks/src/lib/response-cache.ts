import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isPlainObject } from "./schema-primitives.js";
import { silentLogger, type Logger } from "./logger.js";

/**
 * Raw-response caches keyed by content hash (the extraction-side analogue of
 * the verdict cache, docs/TESTING.md §9): repeated identical requests are
 * free across runs and processes, stored responses are always re-validated at
 * the trust boundary on read, and cache files live only under gitignored
 * run-output paths. A malformed or missing cache file simply starts empty —
 * a cache may never make a run fail.
 */

export interface ResponseCache {
  get(key: string): unknown;
  set(key: string, response: unknown): void;
}

export class MemoryResponseCache implements ResponseCache {
  readonly #entries = new Map<string, unknown>();

  get(key: string): unknown {
    return this.#entries.get(key);
  }

  set(key: string, response: unknown): void {
    this.#entries.set(key, response);
  }
}

export class FileResponseCache implements ResponseCache {
  readonly #path: string;
  readonly #entries = new Map<string, unknown>();
  readonly #log: Logger;

  constructor(path: string, log: Logger = silentLogger) {
    this.#path = path;
    this.#log = log;
    this.#load();
  }

  get(key: string): unknown {
    return this.#entries.get(key);
  }

  set(key: string, response: unknown): void {
    this.#entries.set(key, response);
    this.#flush();
  }

  #load(): void {
    if (!existsSync(this.#path)) {
      this.#log.info(`extract cache: empty (no file at ${this.#path})`);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.#path, "utf8"));
    } catch {
      this.#log.info(`extract cache: malformed file at ${this.#path}, starting empty`);
      return;
    }
    if (!isPlainObject(raw)) return;
    for (const [key, value] of Object.entries(raw)) {
      if (isPlainObject(value)) this.#entries.set(key, value);
    }
    this.#log.info(`extract cache: loaded ${this.#entries.size} entr(ies) from ${this.#path}`);
  }

  #flush(): void {
    mkdirSync(dirname(this.#path), { recursive: true });
    writeFileSync(
      this.#path,
      `${JSON.stringify(Object.fromEntries(this.#entries), null, 2)}\n`,
    );
  }
}
