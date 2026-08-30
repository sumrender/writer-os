import type { StoryFacts, ThreadStatus } from "./story-facts.js";

/**
 * Story Bible shape (issue #14, refined in #17 and #19): the synthesized,
 * author-facing document distilled from the graded Story Facts store and the
 * chapter texts
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

/** The World slice (issue #16): classification, description, and the world's
 * rules stated in explicit relation to real-world (earth) rules. */
export interface WorldSection {
  readonly classification: WorldClassification;
  readonly description: string;
  readonly rules: readonly WorldRule[];
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

/** Grounding of a world-timeline event: `stated` when directly in canon prose, `inferred` when synthesized from ordering/backstory. */
export type TimelineGrounding = "stated" | "inferred";

export const TIMELINE_GROUNDINGS: readonly TimelineGrounding[] = ["stated", "inferred"];

/** One event on the world (in-world) timeline. */
export interface WorldTimelineEvent {
  readonly event: string;
  readonly grounding: TimelineGrounding;
}

/** One entry on the book (narration) timeline, mapping a chapter ordinal to the events revealed in that chapter. */
export interface BookTimelineEntry {
  readonly ordinal: number;
  readonly events: readonly string[];
}

/** The sections the Synthesize port models and validates. */
export interface ModelSections {
  readonly bookOverview: BookOverview;
  readonly world: WorldSection;
  readonly characterProfiles: readonly CharacterProfile[];
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
  readonly worldTimeline: readonly WorldTimelineEvent[];
  readonly bookTimeline: readonly BookTimelineEntry[];
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

/** The valid empty overview: nothing established yet. */
export function emptyBookOverview(): BookOverview {
  return { title: "", genre: "", era: "", setting: "", premise: "", synopsis: "", themes: "" };
}

/** The valid EMPTY world placeholder: nothing established beyond earth rules. */
export function emptyWorldSection(): WorldSection {
  return { classification: "earth", description: "", rules: [] };
}

export function emptyStoryBible(): StoryBible {
  return {
    bookOverview: emptyBookOverview(),
    world: emptyWorldSection(),
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
