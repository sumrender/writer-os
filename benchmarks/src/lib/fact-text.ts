import type { StoryFacts, EntityKind } from "./story-facts.js";
import { canonicalJson } from "./canonical-json.js";

/**
 * Renders structured Story Facts entries as fact descriptors: the currency of
 * the open-world sweep and judge prompts. Each fact carries a content key so
 * matched/claimed/unmatched bookkeeping never depends on object identity.
 */

export interface Fact {
  readonly entityKind: EntityKind;
  /** Content identity: stable across runs regardless of key order. */
  readonly key: string;
  /** Human-readable rendering handed to judges and reports. */
  readonly text: string;
}

export function entryKey(entityKind: EntityKind, payload: unknown): string {
  return `${entityKind}:${canonicalJson(payload)}`;
}

export function storyFacts(facts: StoryFacts): readonly Fact[] {
  return [
    ...facts.characters.map((entry): Fact => ({
      entityKind: "character",
      key: entryKey("character", entry),
      text: `character named "${entry.name}"`,
    })),
    ...facts.appearances.map((entry): Fact => ({
      entityKind: "appearance",
      key: entryKey("appearance", entry),
      text: `"${entry.character}" — ${entry.attribute}: ${entry.contains}`,
    })),
    ...facts.relationships.map((entry): Fact => ({
      entityKind: "relationship",
      key: entryKey("relationship", entry),
      text: `"${entry.from}" is the "${entry.relationType}" of "${entry.to}"`,
    })),
    ...facts.items.map((entry): Fact => ({
      entityKind: "item",
      key: entryKey("item", entry),
      text: `item "${entry.item}" is held by "${entry.holder}"`,
    })),
    ...facts.locations.map((entry): Fact => ({
      entityKind: "location",
      key: entryKey("location", entry),
      text: `location named "${entry.name}"`,
    })),
    ...facts.threads.map((entry): Fact => ({
      entityKind: "thread",
      key: entryKey("thread", entry),
      text: `plot thread "${entry.thread}" stands ${entry.status}`,
    })),
    ...facts.worldRules.map((entry): Fact => ({
      entityKind: "world_rule",
      key: entryKey("world_rule", entry),
      text: `world rule: ${entry.topic}`,
    })),
    ...facts.timeline.map((event): Fact => ({
      entityKind: "timeline",
      key: entryKey("timeline", event),
      text: `in-world event happened: ${event}`,
    })),
    ...facts.lexicon.map((entry): Fact => ({
      entityKind: "lexicon",
      key: entryKey("lexicon", entry),
      text: `lexicon term "${entry.term}"${entry.lockedSpelling ? " (spelling locked)" : ""}`,
    })),
    ...facts.style.map((entry): Fact => ({
      entityKind: "style",
      key: entryKey("style", entry),
      text: `style guide sets ${entry.field} to "${entry.value}"`,
    })),
  ];
}
