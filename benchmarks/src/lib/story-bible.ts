import type { ThreadStatus } from "./story-facts.js";

/**
 * Story Bible shape (issue #14): the synthesized, author-facing document
 * distilled from the graded Story Facts store and the chapter texts
 * (ADR-0007: two-layer canon). Twelve *model* sections are produced by the
 * Synthesize port; two members are derived, never modeled —
 * `chapterSummaries` is carried from the synthesis inputs and `graph` is the
 * deterministic derivation in `bible-graph.ts`.
 */

/** The World slice (issue #16): classification, description, and the world's
 * rules stated in explicit relation to real-world (earth) rules. */
export const WORLD_CLASSIFICATIONS = ["earth", "fantasy", "supernatural", "hybrid"] as const;
export type WorldClassification = (typeof WORLD_CLASSIFICATIONS)[number];

/** How one world rule relates to the real-world (earth) rules it deviates
 * from or agrees with. */
export const WORLD_RULE_RELATIONS = ["same_as_earth", "deviates_from_earth"] as const;
export type WorldRuleRelation = (typeof WORLD_RULE_RELATIONS)[number];

export interface WorldRule {
  readonly rule: string;
  readonly relation: WorldRuleRelation;
  /** Prose stating the relation to earth rules in detail. */
  readonly note: string;
}

export interface WorldSection {
  readonly classification: WorldClassification;
  readonly description: string;
  readonly rules: readonly WorldRule[];
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
  readonly world: WorldSection;
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

/** The valid EMPTY world placeholder: nothing established beyond earth rules. */
export function emptyWorldSection(): WorldSection {
  return { classification: "earth", description: "", rules: [] };
}

export function emptyStoryBible(): StoryBible {
  return {
    bookOverview: "",
    world: emptyWorldSection(),
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
