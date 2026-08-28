import type { BibleState } from "./bible.js";

/**
 * The Story Bible merge algebra shared by every extractor implementation
 * (deterministic fakes and vendor-backed alike): the semantics of folding an
 * extracted fact into canon state — items, threads, and style replace their
 * prior entries by identity key; relationships replace by endpoint pair;
 * characters dedupe wholly; appearances, world rules, lexicon terms, and
 * timeline events append when genuinely new. Graders depend on this algebra
 * behaving identically regardless of where facts came from.
 */

export type ExtractedFact =
  | ({ readonly kind: "character" } & import("./bible.js").CharacterEntry)
  | ({ readonly kind: "appearance" } & import("./bible.js").AppearanceEntry)
  | ({ readonly kind: "relationship" } & import("./bible.js").RelationshipEntry)
  | ({ readonly kind: "item" } & import("./bible.js").ItemEntry)
  | ({ readonly kind: "thread" } & import("./bible.js").ThreadEntry)
  | ({ readonly kind: "world_rule" } & import("./bible.js").WorldRuleEntry)
  | { readonly kind: "timeline"; readonly event: string }
  | ({ readonly kind: "lexicon" } & import("./bible.js").LexiconEntry)
  | ({ readonly kind: "style" } & import("./bible.js").StyleEntry);

/** Equality on plain data entries; key order is fixed by our own constructors. */
function serializedEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function appendIfNew<T>(list: readonly T[], entry: T): T[] {
  return list.some((existing) => serializedEqual(existing, entry))
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

export function applyFact(bible: BibleState, fact: ExtractedFact): BibleState {
  switch (fact.kind) {
    case "character":
      return {
        ...bible,
        characters: appendIfNew(bible.characters, { name: fact.name }),
      };
    case "appearance":
      return {
        ...bible,
        appearances: appendIfNew(bible.appearances, {
          character: fact.character,
          attribute: fact.attribute,
          contains: fact.contains,
        }),
      };
    case "relationship":
      return {
        ...bible,
        relationships: replaceOrAppend(
          bible.relationships,
          { from: fact.from, to: fact.to, relationType: fact.relationType },
          (r) => `${r.from}→${r.to}`,
        ),
      };
    case "item":
      return {
        ...bible,
        items: replaceOrAppend(
          bible.items,
          { item: fact.item, holder: fact.holder },
          (i) => i.item,
        ),
      };
    case "thread":
      return {
        ...bible,
        threads: replaceOrAppend(
          bible.threads,
          { thread: fact.thread, status: fact.status },
          (t) => t.thread,
        ),
      };
    case "world_rule":
      return { ...bible, worldRules: appendIfNew(bible.worldRules, { topic: fact.topic }) };
    case "timeline":
      return { ...bible, timeline: appendIfNew(bible.timeline, fact.event) };
    case "lexicon":
      return {
        ...bible,
        lexicon: appendIfNew(bible.lexicon, {
          term: fact.term,
          lockedSpelling: fact.lockedSpelling,
        }),
      };
    case "style":
      return {
        ...bible,
        style: replaceOrAppend(
          bible.style,
          { field: fact.field, value: fact.value },
          (s) => s.field,
        ),
      };
  }
}

