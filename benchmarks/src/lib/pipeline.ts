import type { BibleState, EntityKind } from "./bible.js";

/**
 * The pipeline-under-test port (docs/TESTING.md): three operations with strict
 * structured data on both boundaries. Real vendor-backed implementations plug
 * in behind these signatures; fakes implement them deterministically.
 */

/** extract(chapterText, ordinal, bibleSoFar) → next bible state. */
export type Extract = (
  chapterText: string,
  ordinal: number,
  bibleSoFar: BibleState,
) => Promise<BibleState>;

export interface CheckFlag {
  readonly kind: EntityKind;
  readonly message: string;
}

export interface CheckResult {
  readonly flags: readonly CheckFlag[];
}

/** check(bibleStateAsOf, chapterText) → flags raised against canon state. */
export type Check = (
  bibleStateAsOf: BibleState,
  chapterText: string,
) => Promise<CheckResult>;

export interface GenerationContext {
  /** Context is assembled through this ordinal; generation produces N+1. */
  readonly throughOrdinal: number;
  /**
   * The assembled context through that ordinal (bible state rendered per the
   * pipeline's assembly rules) — what a real generator would condition on.
   */
  readonly assembledContext: string;
  readonly bibleStateAsOf: BibleState;
}

export interface BeatIntent {
  readonly beats: readonly string[];
}

export interface GeneratedChapter {
  readonly ordinal: number;
  readonly text: string;
}

/** generate(assembledContextThroughN, optionalBeatIntent) → generated chapter. */
export type Generate = (
  context: GenerationContext,
  intent?: BeatIntent,
) => Promise<GeneratedChapter>;
