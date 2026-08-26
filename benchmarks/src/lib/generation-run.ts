import { canonBeforeOrdinal, snapshotsByOrdinal, type ExtractionSnapshot } from "./extraction-run.js";
import { renderAssembledContext } from "./assembled-context.js";
import { gradeBeats } from "./beat-grade.js";
import type { BeatChapter } from "./beats.js";
import type { Check, CheckFlag, Generate } from "./pipeline.js";
import type { EquivalenceChecker } from "./judge.js";

/**
 * Drives generation dual-grading (docs/TESTING.md §8) over a book's declared
 * beat chapters. For each declared chapter N: context is assembled from
 * canon strictly *before* N (mirrors checker-run.ts's cutoff — a real
 * generator never sees the chapter it is about to write), `generate`
 * produces chapter N with the chapter's `must_include` beats offered as
 * intent, and the result is graded two ways in the same pass: beat presence
 * (content fidelity) via `gradeBeats`, and factual flags from running the
 * generated prose back through `check` against that same canon (context
 * assembly). The two grades fail for visibly different reasons.
 */

export interface GenerationCaseResult {
  readonly ordinal: number;
  readonly generatedText: string;
  readonly missingBeats: readonly string[];
  readonly violatedBeats: readonly string[];
  readonly factualFlags: readonly CheckFlag[];
}

export async function runGenerationCases(
  chapters: readonly BeatChapter[],
  snapshots: readonly ExtractionSnapshot[],
  generate: Generate,
  check: Check,
  judge: EquivalenceChecker,
): Promise<readonly GenerationCaseResult[]> {
  const canonByOrdinal = snapshotsByOrdinal(snapshots);

  const results: GenerationCaseResult[] = [];
  for (const chapter of chapters) {
    const throughOrdinal = chapter.ordinal - 1;
    const bibleStateAsOf = canonBeforeOrdinal(chapter.ordinal, canonByOrdinal);
    const assembledContext = renderAssembledContext(bibleStateAsOf);

    const generated = await generate(
      { throughOrdinal, assembledContext, bibleStateAsOf },
      chapter.mustInclude.length > 0 ? { beats: chapter.mustInclude } : undefined,
    );

    const beatGrade = await gradeBeats(generated.text, chapter, judge);
    const checkResult = await check(bibleStateAsOf, generated.text);

    results.push({
      ordinal: chapter.ordinal,
      generatedText: generated.text,
      missingBeats: beatGrade.missingBeats,
      violatedBeats: beatGrade.violatedBeats,
      factualFlags: checkResult.flags,
    });
  }

  return results;
}
