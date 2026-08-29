/**
 * Story Bible state shape: the structured canon both pipelines and graders
 * read. Entries mirror PRD §5.2 entity kinds; the kind list is the single
 * source of truth shared by assertion schemas, pipeline ops, and fakes.
 */

export const ENTITY_KINDS = [
  "character",
  "appearance",
  "relationship",
  "item",
  "thread",
  "world_rule",
  "timeline",
  "lexicon",
  "style",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export type ThreadStatus = "open" | "resolved" | "dormant";

export const THREAD_STATUSES: readonly ThreadStatus[] = ["open", "resolved", "dormant"];

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

export interface BibleState {
  readonly characters: readonly CharacterEntry[];
  readonly appearances: readonly AppearanceEntry[];
  readonly relationships: readonly RelationshipEntry[];
  readonly items: readonly ItemEntry[];
  readonly threads: readonly ThreadEntry[];
  readonly worldRules: readonly WorldRuleEntry[];
  /** In-world events in established order (ADR-0003: never a versioning key). */
  readonly timeline: readonly string[];
  readonly lexicon: readonly LexiconEntry[];
  readonly style: readonly StyleEntry[];
}

export function emptyBible(): BibleState {
  return {
    characters: [],
    appearances: [],
    relationships: [],
    items: [],
    threads: [],
    worldRules: [],
    timeline: [],
    lexicon: [],
    style: [],
  };
}

/** Total Canon entries held by a bible state — the Story Bible's size. */
export function canonEntryCount(bible: BibleState): number {
  return (
    bible.characters.length +
    bible.appearances.length +
    bible.relationships.length +
    bible.items.length +
    bible.threads.length +
    bible.worldRules.length +
    bible.timeline.length +
    bible.lexicon.length +
    bible.style.length
  );
}
