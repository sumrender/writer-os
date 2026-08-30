import type { ThreadStatus } from "./story-facts.js";

/**
 * Story Bible shape (issue #14, refined in #17): the synthesized, author-facing
 * document distilled from the graded Story Facts store and the chapter texts
 * (ADR-0007: two-layer canon). Twelve *model* sections are produced by the
 * Synthesize port; two members are derived, never modeled —
 * `chapterSummaries` is carried from the synthesis inputs and `graph` is the
 * deterministic derivation in `bible-graph.ts`.
 */

/**
 * One character established as having appeared at a location, with the
 * chapter ordinal of their first co-occurrence in the source text. The
 * derivation in `bible-locations.ts` is the single source of truth for the
 * ordinal; the wire validator here only confirms its shape and that the
 * character name is one the canon establishes.
 */
export interface LocationCharacterSeen {
  readonly character: string;
  readonly firstCoOccurrenceOrdinal: number;
}

/**
 * One location's bible entry (issue #17): description, narrative significance,
 * and the characters established as having appeared there with the ordinal of
 * first co-occurrence. The validator rejects invented places and characters
 * never seen at the location in the chapter texts.
 */
export interface LocationProfile {
  readonly name: string;
  readonly description: string;
  readonly significance: string;
  readonly charactersSeen: readonly LocationCharacterSeen[];
}

export interface WorldNote {
  readonly topic: string;
  readonly note: string;
}

export interface ProfileEntry {
  readonly name: string;
  readonly profile: string;
}

export interface ThreadRollup {
  readonly thread: string;
  readonly status: ThreadStatus;
  readonly rollup: string;
}

export interface NamedDescription {
  readonly name: string;
  readonly description: string;
}

export interface LexiconNote {
  readonly term: string;
  readonly note: string;
}

export interface OpenLoop {
  readonly description: string;
  /** Ordinal of the chapter that opened the loop. */
  readonly openedAtOrdinal: number;
}

export interface StyleField {
  readonly field: string;
  readonly value: string;
}

/** The sections the Synthesize port models and validates. */
export interface ModelSections {
  readonly bookOverview: string;
  readonly world: readonly WorldNote[];
  readonly characterProfiles: readonly ProfileEntry[];
  /**
   * Per-location bible entries (issue #17): description, narrative
   * significance, and characters seen at the location with the ordinal of
   * first co-occurrence. Every entry is grounded in the location facts and
   * the chapter texts — the registry validator refuses invented places.
   */
  readonly locations: readonly LocationProfile[];
  readonly threadRollups: readonly ThreadRollup[];
  readonly groups: readonly NamedDescription[];
  readonly itemsOfSignificance: readonly NamedDescription[];
  readonly lexiconNotes: readonly LexiconNote[];
  readonly openLoops: readonly OpenLoop[];
  readonly styleRollup: readonly StyleField[];
  readonly worldTimeline: readonly string[];
  readonly bookTimeline: readonly string[];
}

export type ModelSectionKey = keyof ModelSections;

export interface GraphNode {
  readonly name: string;
  /** Case-sensitive whole-name occurrence count across the chapter texts. */
  readonly importance: number;
  readonly role: "protagonist" | "supporting";
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly relation: string;
}

export interface GraphData {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export interface ChapterSummaryEntry {
  readonly ordinal: number;
  readonly summary: string;
}

export interface StoryBible extends ModelSections {
  /** Carried from the synthesis inputs — one summary per chapter, in order. */
  readonly chapterSummaries: readonly ChapterSummaryEntry[];
  /** Deterministic derivation from Story Facts — never modeled. */
  readonly graph: GraphData;
}

/** One per-ordinal bible state, mirroring the extraction snapshot discipline. */
export interface BibleSnapshot {
  readonly afterOrdinal: number;
  readonly bible: StoryBible;
}

export function emptyGraphData(): GraphData {
  return { nodes: [], edges: [] };
}

export function emptyStoryBible(): StoryBible {
  return {
    bookOverview: "",
    world: [],
    characterProfiles: [],
    locations: [],
    threadRollups: [],
    groups: [],
    itemsOfSignificance: [],
    lexiconNotes: [],
    openLoops: [],
    styleRollup: [],
    worldTimeline: [],
    bookTimeline: [],
    chapterSummaries: [],
    graph: emptyGraphData(),
  };
}

/** Fuses validated model sections with the carried summaries and derived graph. */
export function storyBibleFromSections(
  sections: ModelSections,
  chapterSummaries: readonly ChapterSummaryEntry[],
  graph: GraphData,
): StoryBible {
  return { ...sections, chapterSummaries, graph };
}
