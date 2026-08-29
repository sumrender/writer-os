import type { StoryFacts } from "./story-facts.js";

/**
 * The Story Facts merge algebra shared by every extractor implementation
 * (deterministic fakes and vendor-backed alike): the semantics of folding an
 * extracted fact into canon state — items, threads, and style replace their
 * prior entries by identity key; relationships replace by endpoint pair;
 * characters dedupe wholly; locations append when genuinely new by name;
 * appearances, world rules, lexicon terms, and timeline events append when
 * genuinely new. Graders depend on this algebra
 * behaving identically regardless of where facts came from.
 */

export type ExtractedFact =
  | ({ readonly kind: "character" } & import("./story-facts.js").CharacterEntry)
  | ({ readonly kind: "appearance" } & import("./story-facts.js").AppearanceEntry)
  | ({ readonly kind: "relationship" } & import("./story-facts.js").RelationshipEntry)
  | ({ readonly kind: "item" } & import("./story-facts.js").ItemEntry)
  | ({ readonly kind: "location" } & import("./story-facts.js").LocationEntry)
  | ({ readonly kind: "thread" } & import("./story-facts.js").ThreadEntry)
  | ({ readonly kind: "world_rule" } & import("./story-facts.js").WorldRuleEntry)
  | { readonly kind: "timeline"; readonly event: string }
  | ({ readonly kind: "lexicon" } & import("./story-facts.js").LexiconEntry)
  | ({ readonly kind: "style" } & import("./story-facts.js").StyleEntry);

/** Equality on plain data entries; key order is fixed by our own constructors. */
function serializedEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function appendIfNew<T>(list: readonly T[], entry: T): T[] {
  return list.some((existing) => serializedEqual(existing, entry))
    ? [...list]
    : [...list, entry];
}

/** Appends unless an entry with the same identity key already exists; the
 * first occurrence wins and later same-key entries never replace it. */
function appendIfNewBy<T>(
  list: readonly T[],
  entry: T,
  identity: (entry: T) => string,
): T[] {
  return list.some((existing) => identity(existing) === identity(entry))
    ? [...list]
    : [...list, entry];
}

function replaceOrAppend<T>(
  list: readonly T[],
  entry: T,
  identity: (entry: T) => string,
): T[] {
  const key = identity(entry);
  return list.some((existing) => identity(existing) === key)
    ? list.map((existing) => (identity(existing) === key ? entry : existing))
    : [...list, entry];
}

export function applyFact(facts: StoryFacts, fact: ExtractedFact): StoryFacts {
  switch (fact.kind) {
    case "character":
      return {
        ...facts,
        characters: appendIfNew(facts.characters, { name: fact.name }),
      };
    case "appearance":
      return {
        ...facts,
        appearances: appendIfNew(facts.appearances, {
          character: fact.character,
          attribute: fact.attribute,
          contains: fact.contains,
        }),
      };
    case "relationship":
      return {
        ...facts,
        relationships: replaceOrAppend(
          facts.relationships,
          { from: fact.from, to: fact.to, relationType: fact.relationType },
          (r) => `${r.from}→${r.to}`,
        ),
      };
    case "item":
      return {
        ...facts,
        items: replaceOrAppend(
          facts.items,
          { item: fact.item, holder: fact.holder },
          (i) => i.item,
        ),
      };
    case "location":
      return {
        ...facts,
        locations: appendIfNewBy(facts.locations, { name: fact.name }, (l) => l.name),
      };
    case "thread":
      return {
        ...facts,
        threads: replaceOrAppend(
          facts.threads,
          { thread: fact.thread, status: fact.status },
          (t) => t.thread,
        ),
      };
    case "world_rule":
      return { ...facts, worldRules: appendIfNew(facts.worldRules, { topic: fact.topic }) };
    case "timeline":
      return { ...facts, timeline: appendIfNew(facts.timeline, fact.event) };
    case "lexicon":
      return {
        ...facts,
        lexicon: appendIfNew(facts.lexicon, {
          term: fact.term,
          lockedSpelling: fact.lockedSpelling,
        }),
      };
    case "style":
      return {
        ...facts,
        style: replaceOrAppend(
          facts.style,
          { field: fact.field, value: fact.value },
          (s) => s.field,
        ),
      };
  }
}
