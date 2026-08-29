import { describe, expect, it } from "vitest";
import { emptyStoryFacts } from "./story-facts.js";
import { applyFact, type ExtractedFact } from "./fact-merge.js";

describe("applyFact — the merge algebra every extractor shares", () => {
  it("dedupes characters wholly and replaces items, threads, and styles by identity key", () => {
    let state = emptyStoryFacts();
    state = applyFact(state, { kind: "character", name: "Mara Vey" });
    state = applyFact(state, { kind: "character", name: "Mara Vey" });
    expect(state.characters).toEqual([{ name: "Mara Vey" }]);

    state = applyFact(state, { kind: "item", item: "brass compass", holder: "Mara Vey" });
    state = applyFact(state, { kind: "item", item: "brass compass", holder: "Ilya Fen" });
    expect(state.items).toEqual([{ item: "brass compass", holder: "Ilya Fen" }]);

    state = applyFact(state, { kind: "thread", thread: "the siege", status: "open" });
    state = applyFact(state, { kind: "thread", thread: "the siege", status: "resolved" });
    expect(state.threads).toEqual([{ thread: "the siege", status: "resolved" }]);

    state = applyFact(state, { kind: "style", field: "tense", value: "past" });
    state = applyFact(state, { kind: "style", field: "tense", value: "present" });
    expect(state.style).toEqual([{ field: "tense", value: "present" }]);
  });

  it("replaces relationships by endpoint pair regardless of relation wording", () => {
    let state = emptyStoryFacts();
    const sibling: ExtractedFact = {
      kind: "relationship",
      from: "Ilya",
      to: "Mara",
      relationType: "half-brother",
    };
    state = applyFact(state, sibling);
    state = applyFact(state, { ...sibling, relationType: "brother" });
    expect(state.relationships).toEqual([
      { from: "Ilya", to: "Mara", relationType: "brother" },
    ]);
  });

  it("appends locations only when the name is genuinely new", () => {
    let state = emptyStoryFacts();
    state = applyFact(state, { kind: "location", name: "the northern light" });
    state = applyFact(state, { kind: "location", name: "the northern light" });
    state = applyFact(state, { kind: "location", name: "Vess harbor" });
    expect(state.locations).toEqual([
      { name: "the northern light" },
      { name: "Vess harbor" },
    ]);
  });

  it("appends timeline events in read order and appends only genuinely new facts elsewhere", () => {
    let state = emptyStoryFacts();
    state = applyFact(state, { kind: "timeline", event: "the compass cracked" });
    state = applyFact(state, { kind: "timeline", event: "the compass cracked" });
    state = applyFact(state, { kind: "timeline", event: "the harbor burned" });
    expect(state.timeline).toEqual(["the compass cracked", "the harbor burned"]);

    state = applyFact(state, { kind: "appearance", character: "Mara Vey", attribute: "hair", contains: "grey streak" });
    state = applyFact(state, { kind: "appearance", character: "Mara Vey", attribute: "hair", contains: "grey streak" });
    expect(state.appearances).toHaveLength(1);

    state = applyFact(state, { kind: "world_rule", topic: "compasses point at truth" });
    state = applyFact(state, { kind: "world_rule", topic: "compasses point at truth" });
    expect(state.worldRules).toHaveLength(1);

    state = applyFact(state, { kind: "lexicon", term: "Vess", lockedSpelling: true });
    state = applyFact(state, { kind: "lexicon", term: "Vess", lockedSpelling: true });
    expect(state.lexicon).toHaveLength(1);
  });
});
