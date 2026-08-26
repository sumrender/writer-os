import type { EquivalenceChecker } from "./judge.js";
import type { BeatChapter } from "./beats.js";

/**
 * Beat grading (docs/TESTING.md §8): resolves whether a generated chapter
 * contains each required beat, and does not state any forbidden one.
 * Creative divergence is otherwise fine — grading only reacts to the beats
 * actually declared.
 *
 * Matching mirrors assertion-match.ts's timeline strategy: split the
 * generated text into candidate lines, try an exact match first, and only
 * route to the equivalence-only judge (ADR-0005) when no line is a literal
 * hit. `must_include` beats may be judged (semantic paraphrase is fine);
 * `must_not_include` beats are deterministic tripwires — like `must_not`
 * assertions, they never depend on the judge's opinion, so a paraphrased
 * contradiction the judge alone could catch stays outside this grade
 * (surfaced by content review, not this axis).
 */

export interface BeatGrade {
  readonly missingBeats: readonly string[];
  readonly violatedBeats: readonly string[];
}

function candidateLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function isPresent(
  beat: string,
  lines: readonly string[],
  checker: EquivalenceChecker,
): Promise<boolean> {
  if (lines.some((line) => line.includes(beat))) return true;
  for (const line of lines) {
    if (await checker.areEquivalent({ left: beat, right: line })) return true;
  }
  return false;
}

function isStatedExactly(beat: string, lines: readonly string[]): boolean {
  return lines.some((line) => line.includes(beat));
}

export async function gradeBeats(
  generatedText: string,
  chapter: BeatChapter,
  checker: EquivalenceChecker,
): Promise<BeatGrade> {
  const lines = candidateLines(generatedText);

  const missingBeats: string[] = [];
  for (const beat of chapter.mustInclude) {
    if (!(await isPresent(beat, lines, checker))) {
      missingBeats.push(beat);
    }
  }

  const violatedBeats = chapter.mustNotInclude.filter((beat) => isStatedExactly(beat, lines));

  return { missingBeats, violatedBeats };
}
