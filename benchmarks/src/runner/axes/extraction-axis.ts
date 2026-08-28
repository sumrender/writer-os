import { ENTITY_KINDS, type EntityKind } from "../../lib/bible.js";
import type { AssertionSet } from "../../lib/assertions.js";
import type { ExtractableChapter } from "../../lib/manifest.js";
import type { Extract } from "../../lib/pipeline.js";
import type { Judge } from "../../lib/judge.js";
import { runExtraction } from "../../lib/extraction-run.js";
import { gradeAssertionSet, type GradedAssertion } from "../../lib/grader.js";
import { bookSourceText, sweepUnmatchedFacts } from "../../lib/sweep.js";
import { silentLogger, type Logger } from "../../lib/logger.js";
import {
  globalPrecision,
  kindMetrics,
  RUNS_PER_BOOK,
  statsOf,
  type KindCounts,
  type KindMetrics,
  type Stats,
} from "../../lib/metrics.js";
import { evaluateGates, type GateConfig, type GateEvaluation } from "../../lib/gates.js";

/**
 * Extraction-axis run protocol (docs/TESTING.md §9): `runs` sequential
 * extraction passes per book, each graded deterministically first and
 * judge-mediated only where values differ superficially, plus an open-world
 * sweep per run. Per-kind precision/recall/F1 and the estimated fabrication
 * rate aggregate to mean ± variance; gates evaluate against the means.
 */

export interface ExtractionAxisInput {
  readonly bookId: string;
  /** Chapters in manifest order; extraction re-sorts by ordinal. */
  readonly chapters: readonly ExtractableChapter[];
  readonly assertions: AssertionSet;
  readonly extract: Extract;
  readonly judge: Judge;
  readonly gates: GateConfig;
  readonly runs?: number;
  /** Optional progress sink; defaults to silent. */
  readonly log?: Logger;
}

export interface KindReport {
  readonly precision: Stats;
  readonly recall: Stats;
  readonly f1: Stats;
  readonly tp: Stats;
  readonly fp: Stats;
  readonly fn: Stats;
}

export interface SweepReport {
  readonly swept: Stats;
  readonly unsupported: Stats;
  readonly estimatedFabricationRate: Stats;
}

export interface ExtractionAxisReport {
  readonly book: string;
  readonly axis: "extraction";
  readonly runs: number;
  readonly kinds: readonly { readonly kind: EntityKind; readonly report: KindReport }[];
  readonly globalPrecision: Stats;
  readonly sweep: SweepReport;
  readonly gates: GateEvaluation;
  readonly passed: boolean;
}

export async function runExtractionAxis(input: ExtractionAxisInput): Promise<ExtractionAxisReport> {
  const log = input.log ?? silentLogger;
  const runs = input.runs ?? RUNS_PER_BOOK;
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`extraction axis requires at least one run (got ${input.runs})`);
  }
  log.info(
    `extraction axis: ${input.bookId} — ${runs} run(s), ${input.chapters.length} chapter(s), ${input.assertions.assertions.length} assertion(s)`,
  );

  const sourceText = bookSourceText(
    input.chapters.map((chapter) => ({ ordinal: chapter.ordinal, text: chapter.text })),
  );

  const kindStats = new Map<EntityKind, { metrics: KindMetrics[]; counts: KindCounts[] }>();
  const precisions: number[] = [];
  const sweptPerRun: number[] = [];
  const unsupportedPerRun: number[] = [];

  for (let run = 0; run < runs; run++) {
    log.info(`run ${run + 1}/${runs}: extracting ${input.chapters.length} chapter(s)`);
    const snapshots = await runExtraction(input.chapters, input.extract, log);
    log.info(`run ${run + 1}/${runs}: grading ${input.assertions.assertions.length} assertion(s)`);
    const gradedExtraction = await gradeAssertionSet(
      input.assertions,
      snapshots,
      input.judge,
      log,
    );

    const counts = countsByKind(gradedExtraction.graded);
    precisions.push(globalPrecision([...counts.values()]));
    for (const [kind, kindCounts] of counts) {
      const bucket = kindStats.get(kind) ?? { metrics: [], counts: [] };
      bucket.metrics.push(kindMetrics(kindCounts));
      bucket.counts.push(kindCounts);
      kindStats.set(kind, bucket);
    }
    const passed = gradedExtraction.graded.filter((g) => g.verdict === "pass-exact" || g.verdict === "pass-judged").length;
    log.info(
      `run ${run + 1}/${runs}: graded ${gradedExtraction.graded.length} (${passed} pass, ${gradedExtraction.graded.length - passed} miss)`,
    );

    log.info(`run ${run + 1}/${runs}: sweeping unmatched facts against source`);
    const sweep = await sweepUnmatchedFacts(
      gradedExtraction.finalBible,
      gradedExtraction.claimedKeys,
      sourceText,
      input.judge,
      log,
    );
    sweptPerRun.push(sweep.swept);
    unsupportedPerRun.push(sweep.unsupported);
    log.info(
      `run ${run + 1}/${runs}: swept ${sweep.swept} fact(s), ${sweep.unsupported} unsupported (est. fabrication rate ${(sweep.rate).toFixed(3)})`,
    );
  }

  const kinds = [...kindStats.entries()].map(([kind, bucket]) => ({
    kind,
    report: {
      precision: statsOf(bucket.metrics.map((m) => m.precision)),
      recall: statsOf(bucket.metrics.map((m) => m.recall)),
      f1: statsOf(bucket.metrics.map((m) => m.f1)),
      tp: statsOf(bucket.counts.map((c) => c.tp)),
      fp: statsOf(bucket.counts.map((c) => c.fp)),
      fn: statsOf(bucket.counts.map((c) => c.fn)),
    },
  }));

  const recallByKind = Object.fromEntries(
    kinds.map((entry) => [entry.kind, entry.report.recall.mean]),
  );
  const assertedKinds = new Set(input.assertions.assertions.map((a) => a.kind));
  const gates = evaluateGates(input.gates, {
    kindsPresent: ENTITY_KINDS.filter((kind) => assertedKinds.has(kind)),
    globalPrecision: statsOf(precisions).mean,
    recallByKind,
  });
  log.info(
    `extraction axis: gates ${gates.passed ? "PASS" : "FAIL"} (global precision ${(statsOf(precisions).mean).toFixed(3)})`,
  );

  return {
    book: input.bookId,
    axis: "extraction",
    runs,
    kinds,
    globalPrecision: statsOf(precisions),
    sweep: {
      swept: statsOf(sweptPerRun),
      unsupported: statsOf(unsupportedPerRun),
      estimatedFabricationRate: statsOf(
        sweptPerRun.map((swept, i) =>
          swept === 0 ? 0 : (unsupportedPerRun[i] ?? 0) / swept,
        ),
      ),
    },
    gates,
    passed: gates.passed,
  };
}

/** Maps verdicts to the confusion-matrix counts the metrics consume,
 * covering every entity kind in canonical order. */
function countsByKind(
  graded: readonly GradedAssertion[],
): ReadonlyMap<EntityKind, MutableKindCounts> {
  const byKind = new Map<EntityKind, MutableKindCounts>(
    ENTITY_KINDS.map((kind) => [kind, { tp: 0, fp: 0, fn: 0, tn: 0 }]),
  );

  for (const g of graded) {
    const counts = byKind.get(g.kind);
    if (counts === undefined) continue;
    switch (g.verdict) {
      case "pass-exact":
      case "pass-judged":
        if (g.expect === "must") counts.tp++;
        else counts.tn++;
        break;
      case "omission":
        counts.fn++;
        break;
      case "fabrication":
        counts.fp++;
        break;
    }
  }
  return byKind;
}

type MutableKindCounts = { -readonly [K in keyof KindCounts]: KindCounts[K] };
