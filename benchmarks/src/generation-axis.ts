import type { BeatSet } from "./lib/beats.js";
import type { Check, Extract, Generate } from "./lib/pipeline.js";
import type { EquivalenceChecker } from "./lib/judge.js";
import type { ExtractableChapter } from "./lib/manifest.js";
import { runExtraction } from "./lib/extraction-run.js";
import { runGenerationCases, type GenerationCaseResult } from "./lib/generation-run.js";
import { RUNS_PER_BOOK, statsOf, type Stats } from "./lib/metrics.js";

/**
 * Generation-axis run protocol (docs/TESTING.md §8, §9): `runs` sequential
 * passes per book. Each pass re-extracts canon from the fixture chapters
 * then runs the dual grade over the book's declared beat chapters: beat
 * assertions (content fidelity, judge-mediated for paraphrases) plus the
 * checker-mediated context-assembly path. The two grades fail for visibly
 * different reasons — `beat-failure` (missing or violated beat) versus
 * `assembly-failure` (factual flag raised by the checker) — and a book
 * with no authored beat chapters reports the same vacuous-pass conventions
 * every other axis uses: nothing to assert is perfectly asserted.
 */

type GenerationVerdict = "pass" | "beat-failure" | "assembly-failure";

interface PerOrdinalObservations {
  readonly beatFailure: number;
  readonly assemblyFailure: number;
  readonly factualFlags: number;
  readonly pass: number;
}

export interface GenerationChapterReport {
  readonly ordinal: number;
  /** Fraction of runs in which the generator missed or violated a beat. */
  readonly beatFailureRate: Stats;
  /** Fraction of runs in which the checker raised at least one factual flag. */
  readonly assemblyFailureRate: Stats;
  /** Mean count of factual flags raised by the checker per run. */
  readonly factualFlags: Stats;
  /** Fraction of runs the chapter passed cleanly (1 = pass, 0 = otherwise). */
  readonly verdict: Stats;
}

export interface GenerationAxisReport {
  readonly book: string;
  readonly axis: "generation";
  readonly runs: number;
  readonly chapters: readonly GenerationChapterReport[];
  readonly passed: boolean;
}

export interface GenerationAxisInput {
  readonly bookId: string;
  /** Chapters in manifest order; extraction re-sorts by ordinal. */
  readonly chapters: readonly ExtractableChapter[];
  readonly beats: BeatSet;
  readonly extract: Extract;
  readonly generate: Generate;
  readonly check: Check;
  readonly judge: EquivalenceChecker;
  readonly runs?: number;
}

export async function runGenerationAxis(input: GenerationAxisInput): Promise<GenerationAxisReport> {
  const runs = input.runs ?? RUNS_PER_BOOK;
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`generation axis requires at least one run (got ${input.runs})`);
  }

  const observationsByOrdinal = new Map<number, PerOrdinalObservations[]>(
    input.beats.chapters.map((chapter) => [chapter.ordinal, []]),
  );

  for (let run = 0; run < runs; run++) {
    const snapshots = await runExtraction(input.chapters, input.extract);
    const results = await runGenerationCases(
      input.beats.chapters,
      snapshots,
      input.generate,
      input.check,
      input.judge,
    );

    for (const result of results) {
      const verdict = classify(result);
      observationsFor(observationsByOrdinal, result.ordinal).push({
        beatFailure: verdict === "beat-failure" ? 1 : 0,
        assemblyFailure: verdict === "assembly-failure" ? 1 : 0,
        factualFlags: result.factualFlags.length,
        pass: verdict === "pass" ? 1 : 0,
      });
    }
  }

  const chapters: GenerationChapterReport[] = input.beats.chapters.map((chapter) => {
    const observed = observationsFor(observationsByOrdinal, chapter.ordinal);
    return {
      ordinal: chapter.ordinal,
      beatFailureRate: statsOf(observed.map((o) => o.beatFailure)),
      assemblyFailureRate: statsOf(observed.map((o) => o.assemblyFailure)),
      factualFlags: statsOf(observed.map((o) => o.factualFlags)),
      verdict: statsOf(observed.map((o) => o.pass)),
    };
  });

  return {
    book: input.bookId,
    axis: "generation",
    runs,
    chapters,
    passed: chapters.every((chapter) => chapter.verdict.mean === 1),
  };
}

function observationsFor(
  byOrdinal: ReadonlyMap<number, PerOrdinalObservations[]>,
  ordinal: number,
): PerOrdinalObservations[] {
  const bucket = byOrdinal.get(ordinal);
  if (bucket === undefined) {
    throw new Error(`generation axis: no observation bucket for chapter ${ordinal}`);
  }
  return bucket;
}

function classify(result: GenerationCaseResult): GenerationVerdict {
  if (result.missingBeats.length > 0 || result.violatedBeats.length > 0) return "beat-failure";
  if (result.factualFlags.length > 0) return "assembly-failure";
  return "pass";
}