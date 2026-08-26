import { emptyBible, type BibleState } from "./bible.js";
import type { Extract } from "./pipeline.js";

export interface ExtractionSnapshot {
  readonly afterOrdinal: number;
  readonly bible: BibleState;
}

interface ExtractableChapter {
  readonly ordinal: number;
  readonly text: string;
}

/**
 * Drives extraction sequentially over a whole book in ordinal order
 * (mirrors serialization; enables "as of chapter N" states per ADR-0003),
 * capturing the bible state after each chapter.
 */
export async function runExtraction(
  chapters: readonly ExtractableChapter[],
  extract: Extract,
): Promise<ExtractionSnapshot[]> {
  const snapshots: ExtractionSnapshot[] = [];
  let state: BibleState = emptyBible();

  for (const chapter of [...chapters].sort((a, b) => a.ordinal - b.ordinal)) {
    state = await extract(chapter.text, chapter.ordinal, state);
    snapshots.push({ afterOrdinal: chapter.ordinal, bible: state });
  }

  return snapshots;
}
