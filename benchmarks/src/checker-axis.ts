import type { Check, Extract } from "./lib/pipeline.js";
import type { PerturbationCase } from "./lib/perturbation-file.js";
import type { ExtractableChapter } from "./lib/manifest.js";
import { runExtraction } from "./lib/extraction-run.js";
import { runCheckerCases } from "./lib/checker-run.js";
import { RUNS_PER_BOOK, statsOf, type Stats } from "./lib/metrics.js";

/**
 * Checker-axis run protocol (docs/TESTING.md §7, §9): `runs` sequential
 * passes per book. Each pass re-extracts canon from the fixture chapters,
 * then checks every perturbation/control case against the canon state as of
 * its `base_ordinal`. Perturbations must be flagged (their catch rate is the
 * axis's headline metric); controls must not be (their flag rate is the
 * false-positive rate — the over-flagging risk). A book with no authored
 * cases reports the vacuous-pass conventions used throughout this codebase:
 * nothing to catch is perfectly caught, nothing to falsely flag is never
 * falsely flagged.
 */

export interface CheckerAxisInput {
  readonly bookId: string;
  /** Chapters in manifest order; extraction re-sorts by ordinal. */
  readonly chapters: readonly ExtractableChapter[];
  readonly cases: readonly PerturbationCase[];
  readonly extract: Extract;
  readonly check: Check;
  readonly runs?: number;
}

export interface CheckerCaseReport {
  readonly caseId: string;
  readonly kind: "perturbation" | "control";
  readonly expected: "flag" | "no_flags";
  /** Fraction of runs in which this case's checker call raised a flag. */
  readonly raisedRate: Stats;
}

export interface CheckerAxisReport {
  readonly book: string;
  readonly axis: "checker";
  readonly runs: number;
  readonly cases: readonly CheckerCaseReport[];
  /** Fraction of perturbation cases flagged per run, mean ± variance across runs. */
  readonly perturbationCatchRate: Stats;
  /** Fraction of control cases falsely flagged per run — the over-flagging risk. */
  readonly controlFalsePositiveRate: Stats;
  readonly passed: boolean;
}

const rate = (raised: number, total: number, vacuousValue: number): number =>
  total === 0 ? vacuousValue : raised / total;

export async function runCheckerAxis(input: CheckerAxisInput): Promise<CheckerAxisReport> {
  const runs = input.runs ?? RUNS_PER_BOOK;
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`checker axis requires at least one run (got ${input.runs})`);
  }

  const perturbationCases = input.cases.filter((c) => c.entry.kind === "perturbation");
  const controlCases = input.cases.filter((c) => c.entry.kind === "control");

  const raisedByCase = new Map<string, boolean[]>(input.cases.map((c) => [c.entry.id, []]));
  const catchRatePerRun: number[] = [];
  const fpRatePerRun: number[] = [];

  for (let run = 0; run < runs; run++) {
    const snapshots = await runExtraction(input.chapters, input.extract);
    const results = await runCheckerCases(input.cases, snapshots, input.check);
    const raisedByCaseId = new Map(results.map((r) => [r.caseId, r.raised]));

    for (const [caseId, history] of raisedByCase) {
      history.push(raisedByCaseId.get(caseId) ?? false);
    }

    const perturbationsRaised = perturbationCases.filter(
      (c) => raisedByCaseId.get(c.entry.id) === true,
    ).length;
    const controlsRaised = controlCases.filter(
      (c) => raisedByCaseId.get(c.entry.id) === true,
    ).length;

    catchRatePerRun.push(rate(perturbationsRaised, perturbationCases.length, 1));
    fpRatePerRun.push(rate(controlsRaised, controlCases.length, 0));
  }

  const cases: CheckerCaseReport[] = input.cases.map(({ entry }) => ({
    caseId: entry.id,
    kind: entry.kind,
    expected: entry.expect,
    raisedRate: statsOf((raisedByCase.get(entry.id) ?? []).map((raised) => (raised ? 1 : 0))),
  }));

  const perturbationCatchRate = statsOf(catchRatePerRun);
  const controlFalsePositiveRate = statsOf(fpRatePerRun);

  return {
    book: input.bookId,
    axis: "checker",
    runs,
    cases,
    perturbationCatchRate,
    controlFalsePositiveRate,
    passed: perturbationCatchRate.mean === 1 && controlFalsePositiveRate.mean === 0,
  };
}
