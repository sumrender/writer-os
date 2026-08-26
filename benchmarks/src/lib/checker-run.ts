import { emptyBible, type BibleState } from "./bible.js";
import type { ExtractionSnapshot } from "./extraction-run.js";
import type { Check } from "./pipeline.js";
import type { PerturbationCase } from "./perturbation-file.js";

/**
 * Runs the checker-under-test against perturbation/control cases
 * (docs/TESTING.md §7). Each case's canon is the bible state established
 * strictly *before* its `base_ordinal` chapter — the extraction snapshot
 * after chapter `base_ordinal - 1`, or the empty bible when `base_ordinal`
 * is 1 — so the checker sees only what canon already holds, never the fact
 * the case itself asserts.
 */

export interface CheckerCaseResult {
  readonly caseId: string;
  readonly raised: boolean;
}

export async function runCheckerCases(
  cases: readonly PerturbationCase[],
  snapshots: readonly ExtractionSnapshot[],
  check: Check,
): Promise<readonly CheckerCaseResult[]> {
  const canonByOrdinal = new Map(snapshots.map((s) => [s.afterOrdinal, s.bible]));

  const results: CheckerCaseResult[] = [];
  for (const { entry, chapterText } of cases) {
    const canon = canonBefore(entry.baseOrdinal, canonByOrdinal);
    const result = await check(canon, chapterText);
    results.push({ caseId: entry.id, raised: result.flags.length > 0 });
  }
  return results;
}

function canonBefore(
  baseOrdinal: number,
  canonByOrdinal: ReadonlyMap<number, BibleState>,
): BibleState {
  if (baseOrdinal === 1) return emptyBible();
  const priorOrdinal = baseOrdinal - 1;
  const canon = canonByOrdinal.get(priorOrdinal);
  if (canon === undefined) {
    throw new Error(`runCheckerCases: no extraction snapshot for chapter ${priorOrdinal}`);
  }
  return canon;
}
