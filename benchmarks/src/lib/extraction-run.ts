import { canonEntryCount, emptyBible, type BibleState } from "./bible.js";
import type { ExtractableChapter } from "./manifest.js";
import type { Extract } from "./pipeline.js";
import { silentLogger, type Logger } from "./logger.js";

export interface ExtractionSnapshot {
  readonly afterOrdinal: number;
  readonly bible: BibleState;
}

/** Per-chapter progress hook the extraction loop calls around each extract. */
export interface ExtractionProgress {
  onChapterStart?(ordinal: number): void;
  onChapterComplete?(info: {
    ordinal: number;
    elapsedMs: number;
    bible: BibleState;
  }): void;
}

/**
 * Snapshot-map construction shared by every consumer of `canonBeforeOrdinal`:
 * indexes each extracted bible state by the ordinal whose extraction produced
 * it, so "as of chapter N" lookups have one authoritative source.
 */
export function snapshotsByOrdinal(
  snapshots: readonly ExtractionSnapshot[],
): ReadonlyMap<number, BibleState> {
  return new Map(snapshots.map((s) => [s.afterOrdinal, s.bible]));
}

/**
 * Drives extraction sequentially over a whole book in ordinal order
 * (mirrors serialization; enables "as of chapter N" states per ADR-0003),
 * capturing the bible state after each chapter.
 */
export async function runExtraction(
  chapters: readonly ExtractableChapter[],
  extract: Extract,
  log: Logger = silentLogger,
  progress?: ExtractionProgress,
): Promise<ExtractionSnapshot[]> {
  const snapshots: ExtractionSnapshot[] = [];
  let state: BibleState = emptyBible();

  for (const chapter of [...chapters].sort((a, b) => a.ordinal - b.ordinal)) {
    log.info(
      `  chapter ${chapter.ordinal}: extracting (${chapter.text.length} chars, ${canonEntryCount(state)} canon entries carried)`,
    );
    progress?.onChapterStart?.(chapter.ordinal);
    const t0 = Date.now();
    state = await extract(chapter.text, chapter.ordinal, state);
    const elapsed = Date.now() - t0;
    const totals = canonEntryCount(state);
    log.info(
      `  chapter ${chapter.ordinal}: extracted in ${elapsed}ms (${totals} canon entries total)`,
    );
    progress?.onChapterComplete?.({ ordinal: chapter.ordinal, elapsedMs: elapsed, bible: state });
    snapshots.push({ afterOrdinal: chapter.ordinal, bible: state });
  }

  return snapshots;
}

/**
 * Canon strictly *before* `ordinal` — the extraction snapshot after chapter
 * `ordinal - 1`, or the empty bible when `ordinal` is 1. Shared by every
 * consumer that must see only what canon already holds as of a chapter,
 * never that chapter's own facts (checker-run.ts's perturbation grading,
 * generation-run.ts's context assembly).
 */
export function canonBeforeOrdinal(
  ordinal: number,
  snapshotsByOrdinal: ReadonlyMap<number, BibleState>,
): BibleState {
  if (ordinal <= 1) return emptyBible();
  const priorOrdinal = ordinal - 1;
  const canon = snapshotsByOrdinal.get(priorOrdinal);
  if (canon === undefined) {
    throw new Error(`canonBeforeOrdinal: no extraction snapshot for chapter ${priorOrdinal}`);
  }
  return canon;
}
