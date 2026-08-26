import type { Judge } from "./judge.js";

/**
 * Scripted offline judge for tests and judge-free runs. Answers exactly what
 * it was scripted to answer — never a model — and counts calls so tests can
 * prove caching above it.
 */

export interface StubEquivalenceCase {
  readonly left: string;
  readonly right: string;
  readonly equivalent: boolean;
}

export interface StubSupportCase {
  /** Matches when this string occurs in the rendered fact. */
  readonly factIncludes: string;
  readonly supported: boolean;
}

export interface StubJudgeScript {
  readonly equivalences?: readonly StubEquivalenceCase[];
  readonly support?: readonly StubSupportCase[];
  /** Verdict when no scripted case matches (default: false). */
  readonly defaultEquivalent?: boolean;
  readonly defaultSupported?: boolean;
}

export interface StubJudge extends Judge {
  readonly calls: { equivalence: number; support: number };
}

export function createStubJudge(script: StubJudgeScript = {}): StubJudge {
  const equivalences = script.equivalences ?? [];
  const support = script.support ?? [];
  const calls = { equivalence: 0, support: 0 };

  return {
    calls,
    async areEquivalent({ left, right }) {
      calls.equivalence++;
      const hit = equivalences.find((c) => c.left === left && c.right === right);
      return hit === undefined ? (script.defaultEquivalent ?? false) : hit.equivalent;
    },
    async isSupportedBySource({ fact }) {
      calls.support++;
      const hit = support.find((c) => fact.includes(c.factIncludes));
      return hit === undefined ? (script.defaultSupported ?? false) : hit.supported;
    },
  };
}
