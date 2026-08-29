import { emptyStoryFacts, factCount, type StoryFacts } from "./story-facts.js";
import type { ExtractableChapter } from "./manifest.js";
import type { Extract } from "./pipeline.js";
import { silentLogger, type Logger } from "./logger.js";

export interface ExtractionSnapshot {
  readonly afterOrdinal: number;
  readonly facts: StoryFacts;
}

/** Per-chapter progress hook the extraction loop calls around each extract. */
export interface ExtractionProgress {
  onChapterStart?(ordinal: number): void;
  /**
   * May be async; the loop awaits it so per-chapter synthesis (issue #14)
   * completes before the run proceeds without re-ordering the protocol.
   */
  onChapterComplete?(info: {
    ordinal: number;
    elapsedMs: number;
    facts: StoryFacts;
  }): void | Promise<void>;
}

/**
 * Snapshot-map construction shared by every consumer of `factsBeforeOrdinal`:
 * indexes each extracted facts store by the ordinal whose extraction produced
 * it, so "as of chapter N" lookups have one authoritative source.
 */
export function snapshotsByOrdinal(
  snapshots: readonly ExtractionSnapshot[],
): ReadonlyMap<number, StoryFacts> {
  return new Map(snapshots.map((s) => [s.afterOrdinal, s.facts]));
}

/**
 * Drives extraction sequentially over a whole book in ordinal order
 * (mirrors serialization; enables "as of chapter N" states per ADR-0003),
 * capturing the facts store after each chapter.
 */
export async function runExtraction(
  chapters: readonly ExtractableChapter[],
  extract: Extract,
  log: Logger = silentLogger,
  progress?: ExtractionProgress,
): Promise<ExtractionSnapshot[]> {
  const snapshots: ExtractionSnapshot[] = [];
  let state: StoryFacts = emptyStoryFacts();

  for (const chapter of [...chapters].sort((a, b) => a.ordinal - b.ordinal)) {
    log.info(
      `  chapter ${chapter.ordinal}: extracting (${chapter.text.length} chars, ${factCount(state)} canon entries carried)`,
    );
    progress?.onChapterStart?.(chapter.ordinal);
    const t0 = Date.now();
    state = await extract(chapter.text, chapter.ordinal, state);
    const elapsed = Date.now() - t0;
    const totals = factCount(state);
    log.info(
      `  chapter ${chapter.ordinal}: extracted in ${elapsed}ms (${totals} canon entries total)`,
    );
    await progress?.onChapterComplete?.({ ordinal: chapter.ordinal, elapsedMs: elapsed, facts: state });
    snapshots.push({ afterOrdinal: chapter.ordinal, facts: state });
  }

  return snapshots;
}

/**
 * Canon strictly *before* `ordinal` — the extraction snapshot after chapter
 * `ordinal - 1`, or the empty facts store when `ordinal` is 1. Shared by
 * every consumer that must see only what canon already holds as of a
 * chapter, never that chapter's own facts (checker-run.ts's perturbation
 * grading, generation-run.ts's context assembly).
 */
export function factsBeforeOrdinal(
  ordinal: number,
  snapshotsByOrdinal: ReadonlyMap<number, StoryFacts>,
): StoryFacts {
  if (ordinal <= 1) return emptyStoryFacts();
  const priorOrdinal = ordinal - 1;
  const canon = snapshotsByOrdinal.get(priorOrdinal);
  if (canon === undefined) {
    throw new Error(`factsBeforeOrdinal: no extraction snapshot for chapter ${priorOrdinal}`);
  }
  return canon;
}
