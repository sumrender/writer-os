import type { StoryFacts, EntityKind } from "./story-facts.js";
import type { ChapterSummaryEntry, StoryBible } from "./story-bible.js";

/**
 * The pipeline-under-test port (docs/TESTING.md): operations with strict
 * structured data on both boundaries. Real vendor-backed implementations plug
 * in behind these signatures; fakes implement them deterministically.
 */

/** extract(chapterText, ordinal, factsSoFar) → next facts state. */
export type Extract = (
  chapterText: string,
  ordinal: number,
  factsSoFar: StoryFacts,
) => Promise<StoryFacts>;

export interface CheckFlag {
  readonly kind: EntityKind;
  readonly message: string;
}

export interface CheckResult {
  readonly flags: readonly CheckFlag[];
}

/** check(factsAsOf, chapterText) → flags raised against canon state. */
export type Check = (
  factsAsOf: StoryFacts,
  chapterText: string,
) => Promise<CheckResult>;

export interface GenerationContext {
  /** Context is assembled through this ordinal; generation produces N+1. */
  readonly throughOrdinal: number;
  /**
   * The assembled context through that ordinal (facts state rendered per the
   * pipeline's assembly rules) — what a real generator would condition on.
   */
  readonly assembledContext: string;
  readonly factsAsOf: StoryFacts;
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

export interface ChapterSummaryRequest {
  /** 1-based ordinal of the chapter being summarized. */
  readonly ordinal: number;
  /** The chapter's text. */
  readonly text: string;
  /**
   * Canon established BEFORE this chapter — the summary never sees later
   * canon, mirroring extraction's no-answer-leakage discipline (issue #14).
   */
  readonly factsSoFar: StoryFacts;
}

/** synthesizeChapterSummary(request) → the summary entry for that ordinal. */
export type SynthesizeChapterSummary = (
  input: ChapterSummaryRequest,
) => Promise<ChapterSummaryEntry>;

export interface BibleSynthesisInput {
  /** The chapter texts, ordinals 1..N in book order. */
  readonly chapters: readonly string[];
  /** Story Facts as of ordinal N — the canon after the last chapter. */
  readonly facts: StoryFacts;
  /** The synthesized chapter summaries, ordinals 1..N in book order. */
  readonly summaries: readonly ChapterSummaryEntry[];
}

/** synthesizeBible(input) → the full Story Bible through ordinal N. */
export type SynthesizeBible = (input: BibleSynthesisInput) => Promise<StoryBible>;

/**
 * Bible synthesis strategies (issue #14): `per-section` makes one focused
 * forced-tool call per model section (default, for synthesis quality);
 * `monolithic` composes the same section blocks into one call. The strategy
 * rides in the synthesis cache keys so the two paths never collide.
 */
export const SYNTHESIS_STRATEGIES = ["per-section", "monolithic"] as const;
export type SynthesisStrategy = (typeof SYNTHESIS_STRATEGIES)[number];
