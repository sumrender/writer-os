import type { Assertion, AssertionSet, Expectation } from "./assertions.js";
import type { BibleState, EntityKind } from "./bible.js";
import type { ExtractionSnapshot } from "./extraction-run.js";
import type { EquivalenceChecker } from "./judge.js";
import { findMatch } from "./assertion-match.js";

/**
 * Grades an assertion set against sequential extraction snapshots
 * (docs/TESTING.md §6). A satisfied `must` is a true positive; an unsatisfied
 * one is an omission; a triggered `must_not` is a fabrication. Matched facts
 * are claimed by content key so the open-world sweep can identify what no
 * positive assertion accounts for.
 */

export type AssertionVerdict = "pass-exact" | "pass-judged" | "omission" | "fabrication";

export interface GradedAssertion {
  readonly assertionId: string;
  readonly kind: EntityKind;
  readonly expect: Expectation;
  /** Ordinal of the snapshot the assertion was graded against. */
  readonly gradedAtOrdinal: number;
  readonly verdict: AssertionVerdict;
}

export interface GradedExtraction {
  readonly graded: readonly GradedAssertion[];
  /** Content keys (any ordinal) claimed by matched `must` assertions. */
  readonly claimedKeys: ReadonlySet<string>;
  readonly finalBible: BibleState;
  readonly finalOrdinal: number;
}

export async function gradeAssertionSet(
  set: AssertionSet,
  snapshots: readonly ExtractionSnapshot[],
  checker: EquivalenceChecker,
): Promise<GradedExtraction> {
  if (snapshots.length === 0) {
    throw new Error("gradeAssertionSet requires at least one extraction snapshot");
  }
  const last = snapshots[snapshots.length - 1];
  if (last === undefined) {
    throw new Error("gradeAssertionSet requires at least one extraction snapshot");
  }

  const claimedKeys = new Set<string>();
  const graded: GradedAssertion[] = [];

  for (const assertion of set.assertions) {
    const snapshot = snapshotFor(assertion, snapshots, last.afterOrdinal);
    const outcome = await findMatch(assertion, snapshot.bible, checker);

    let verdict: AssertionVerdict;
    if (outcome === undefined) {
      verdict = assertion.expect === "must" ? "omission" : "pass-exact";
    } else if (assertion.expect === "must_not") {
      verdict = "fabrication";
    } else {
      verdict = outcome.mode === "exact" ? "pass-exact" : "pass-judged";
      for (const key of outcome.claimedKeys) claimedKeys.add(key);
    }

    graded.push({
      assertionId: assertion.id,
      kind: assertion.kind,
      expect: assertion.expect,
      gradedAtOrdinal: snapshot.afterOrdinal,
      verdict,
    });
  }

  return {
    graded,
    claimedKeys,
    finalBible: last.bible,
    finalOrdinal: last.afterOrdinal,
  };
}

function snapshotFor(
  assertion: Assertion,
  snapshots: readonly ExtractionSnapshot[],
  finalOrdinal: number,
): ExtractionSnapshot {
  const target = assertion.asOf ?? finalOrdinal;
  const found = snapshots.find((s) => s.afterOrdinal === target);
  if (found === undefined) {
    throw new Error(`assertion ${assertion.id}: no extraction snapshot for as_of ${target}`);
  }
  return found;
}
