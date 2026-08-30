import type { StoryFacts, ThreadStatus } from "./story-facts.js";

/**
 * Story Bible shape (issue #14): the synthesized, author-facing document
 * distilled from the graded Story Facts store and the chapter texts
 * (ADR-0007: two-layer canon). Twelve *model* sections are produced by the
 * Synthesize port; two members are derived, never modeled —
 * `chapterSummaries` is carried from the synthesis inputs and `graph` is the
 * deterministic derivation in `bible-graph.ts`.
 */

export interface WorldNote {
  readonly topic: string;
  readonly note: string;
}

export interface ProfileEntry {
  readonly name: string;
  readonly profile: string;
}

/** One prose-form relationship summary inside a character profile (issue #15). */
export interface CharacterRelationship {
  /** The other party, spelled exactly as canon establishes the name. */
  readonly other: string;
  /** The relationship in prose, grounded in canon relationship facts. */
  readonly summary: string;
}

/**
 * The rich character profile (issue #15): every aspect distilled from Story
 * Facts and chapter summaries, never from the chapter text alone. Prose
 * aspects canon establishes nothing about are the empty string — never
 * invented.
 */
export interface CharacterProfile {
  readonly name: string;
  readonly appearance: string;
  readonly personality: string;
  readonly definingTraits: readonly string[];
  readonly background: string;
  readonly arc: string;
  /** Ordinal of the first chapter that mentions the character. */
  readonly firstAppearanceOrdinal: number;
  /** Every ordinal whose summary mentions the character, ascending, unique. */
  readonly mentionOrdinals: readonly number[];
  readonly relationships: readonly CharacterRelationship[];
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
  readonly characterProfiles: readonly CharacterProfile[];
  readonly locationProfiles: readonly ProfileEntry[];
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

/**
 * The canon view every model section's validator and deterministic fake sees
 * (issue #15): Story Facts as of the synthesis ordinal plus the chapter
 * summaries so far — the same grounding synthesis is held to. Raw chapter
 * text is deliberately absent: profiles derive from facts and summaries,
 * never from the chapter text alone.
 */
export interface SectionCanon {
  readonly facts: StoryFacts;
  readonly chapterSummaries: readonly ChapterSummaryEntry[];
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
    locationProfiles: [],
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
