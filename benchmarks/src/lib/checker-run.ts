import { canonBeforeOrdinal, snapshotsByOrdinal, type ExtractionSnapshot } from "./extraction-run.js";
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
  const canonByOrdinal = snapshotsByOrdinal(snapshots);

  const results: CheckerCaseResult[] = [];
  for (const { entry, chapterText } of cases) {
    const canon = canonBeforeOrdinal(entry.baseOrdinal, canonByOrdinal);
    const result = await check(canon, chapterText);
    results.push({ caseId: entry.id, raised: result.flags.length > 0 });
  }
  return results;
}
