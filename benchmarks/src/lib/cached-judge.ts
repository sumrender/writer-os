import type { EquivalenceRequest, Judge, SourceSupportRequest } from "./judge.js";
import { hashVerdictInput, type VerdictCache } from "./verdict-cache.js";

/**
 * Decorator making any Judge cache-backed: identical inputs (op + request)
 * hash to one key, so repeats — across runs, regrades, or processes when a
 * FileVerdictCache is used — never reach the wrapped judge.
 */
export class CachingJudge implements Judge {
  readonly #inner: Judge;
  readonly #cache: VerdictCache;

  constructor(inner: Judge, cache: VerdictCache) {
    this.#inner = inner;
    this.#cache = cache;
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
    if (cached !== undefined) return cached;
    const verdict = await fetchVerdict();
    this.#cache.set(key, verdict);
    return verdict;
  }
}
