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

/**
 * The book-level overview (issue #19): the author-facing statement of what
 * the book is, synthesized per ordinal. Every field is free prose grounded
 * in the canon *as of that ordinal* — title, genre, era, setting, premise,
 * the one-page synopsis (never a final-book spoiler at an early ordinal),
 * and themes.
 */
export interface BookOverview {
  readonly title: string;
  readonly genre: string;
  readonly era: string;
  readonly setting: string;
  readonly premise: string;
  readonly synopsis: string;
  readonly themes: string;
}

/**
 * The determinism inputs the section registry's fakes consume: the graded
 * canon and the chapter summaries through the current ordinal. Both are
 * always available to the Synthesize port, so a deterministic fake can
 * ground its prose in exactly what synthesis itself sees.
 */
export interface BibleSynthesisContext {
  readonly facts: StoryFacts;
  readonly summaries: readonly ChapterSummaryEntry[];
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
  readonly bookOverview: BookOverview;
  readonly world: readonly WorldNote[];
  readonly characterProfiles: readonly ProfileEntry[];
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

/** One per-ordinal bible state, mirroring the extraction snapshot discipline. */
export interface BibleSnapshot {
  readonly afterOrdinal: number;
  readonly bible: StoryBible;
}

export function emptyGraphData(): GraphData {
  return { nodes: [], edges: [] };
}

/** The valid empty overview: nothing established yet. */
export function emptyBookOverview(): BookOverview {
  return { title: "", genre: "", era: "", setting: "", premise: "", synopsis: "", themes: "" };
}

export function emptyStoryBible(): StoryBible {
  return {
    bookOverview: emptyBookOverview(),
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
