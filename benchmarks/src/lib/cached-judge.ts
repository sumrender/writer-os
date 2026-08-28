import type { EquivalenceRequest, Judge, SourceSupportRequest } from "./judge.js";
import { hashVerdictInput, type VerdictCache } from "./verdict-cache.js";
import { silentLogger, type Logger } from "./logger.js";

/**
 * Decorator making any Judge cache-backed: identical inputs (op + request)
 * hash to one key, so repeats — across runs, regrades, or processes when a
 * FileVerdictCache is used — never reach the wrapped judge.
 */
export class CachingJudge implements Judge {
  readonly #inner: Judge;
  readonly #cache: VerdictCache;
  readonly #log: Logger;

  constructor(inner: Judge, cache: VerdictCache, log: Logger = silentLogger) {
    this.#inner = inner;
    this.#cache = cache;
    this.#log = log;
  }

  async areEquivalent(request: EquivalenceRequest): Promise<boolean> {
    return this.#cached("equivalence", request, () => this.#inner.areEquivalent(request));
  }

  async isSupportedBySource(request: SourceSupportRequest): Promise<boolean> {
    return this.#cached("source_support", request, () =>
      this.#inner.isSupportedBySource(request),
    );
  }

  async #cached(
    operation: string,
    request: EquivalenceRequest | SourceSupportRequest,
    fetchVerdict: () => Promise<boolean>,
  ): Promise<boolean> {
    const key = hashVerdictInput(operation, request);
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      this.#log.debug(
        `      judge cache HIT (${operation}) → ${cached} (key ${key.slice(0, 12)}…)`,
      );
      return cached;
    }
    this.#log.debug(
      `      judge cache MISS (${operation}); calling inner judge (key ${key.slice(0, 12)}…)`,
    );
    const verdict = await fetchVerdict();
    this.#log.debug(`      judge verdict: ${verdict}`);
    this.#cache.set(key, verdict);
    return verdict;
  }
}
