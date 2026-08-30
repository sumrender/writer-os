/**
 * Story Facts shape: the structured canon both pipelines and graders
 * read. Entries mirror PRD §5.2 entity kinds; the kind list is the single
 * source of truth shared by assertion schemas, pipeline ops, and fakes.
 */

export const ENTITY_KINDS = [
  "character",
  "appearance",
  "relationship",
  "item",
  "location",
  "thread",
  "world_rule",
  "timeline",
  "lexicon",
  "style",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export type ThreadStatus = "open" | "resolved" | "dormant";

export const THREAD_STATUSES: readonly ThreadStatus[] = ["open", "resolved", "dormant"];

/**
 * Narrows an unknown value to a {@link ThreadStatus} — the single home of this
 * meaning (CODING_STANDARDS §2.1): the status vocabulary and its guard live
 * here, beside the vocabulary itself.
 */
export function isThreadStatus(value: unknown): value is ThreadStatus {
  return typeof value === "string" && (THREAD_STATUSES as readonly string[]).includes(value);
}

export interface CharacterEntry {
  readonly name: string;
}

export interface AppearanceEntry {
  readonly character: string;
  readonly attribute: string;
  readonly contains: string;
}

export interface RelationshipEntry {
  readonly from: string;
  readonly to: string;
  readonly relationType: string;
}

export interface ItemEntry {
  readonly item: string;
  readonly holder: string;
}

export interface LocationEntry {
  readonly name: string;
}

export interface ThreadEntry {
  readonly thread: string;
  readonly status: ThreadStatus;
}

export interface WorldRuleEntry {
  readonly topic: string;
}

export interface LexiconEntry {
  readonly term: string;
  readonly lockedSpelling: boolean;
}

export interface StyleEntry {
  readonly field: string;
  readonly value: string;
}

export interface StoryFacts {
  readonly characters: readonly CharacterEntry[];
  readonly appearances: readonly AppearanceEntry[];
  readonly relationships: readonly RelationshipEntry[];
  readonly items: readonly ItemEntry[];
  readonly locations: readonly LocationEntry[];
  readonly threads: readonly ThreadEntry[];
  readonly worldRules: readonly WorldRuleEntry[];
  /** In-world events in established order (ADR-0003: never a versioning key). */
  readonly timeline: readonly string[];
  readonly lexicon: readonly LexiconEntry[];
  readonly style: readonly StyleEntry[];
}

export function emptyStoryFacts(): StoryFacts {
  return {
    characters: [],
    appearances: [],
    relationships: [],
    items: [],
    locations: [],
    threads: [],
    worldRules: [],
    timeline: [],
    lexicon: [],
    style: [],
  };
}

/** Total Canon entries held by a Story Facts store — its size. */
export function factCount(facts: StoryFacts): number {
  return (
    facts.characters.length +
    facts.appearances.length +
    facts.relationships.length +
    facts.items.length +
    facts.locations.length +
    facts.threads.length +
    facts.worldRules.length +
    facts.timeline.length +
    facts.lexicon.length +
    facts.style.length
  );
}
