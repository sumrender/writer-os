import { describe, expect, it } from "vitest";
import { deriveGraphData } from "./bible-graph.js";
import { emptyStoryFacts, type StoryFacts } from "./story-facts.js";

/**
 * Graph data derivation (issue #14): deterministic, facts-only. Nodes come
 * from characters with whole-name occurrence importance; edges come from
 * relationship facts; missing relationship endpoints join as importance-0
 * supporting nodes. The protagonist role is the single source of truth —
 * no top-level protagonist field exists.
 */

/** A writable facts store for building fixture facts in tests. */
type WritableFacts = {
  -readonly [K in keyof StoryFacts]: StoryFacts[K] extends readonly (infer E)[]
    ? E[]
    : StoryFacts[K];
};

function factsWith(mutate: (facts: WritableFacts) => void): StoryFacts {
  const facts = structuredClone(emptyStoryFacts()) as WritableFacts;
  mutate(facts);
  return facts;
}

describe("deriveGraphData", () => {
  it("produces an empty graph from empty facts", () => {
    expect(deriveGraphData({ facts: emptyStoryFacts(), chapterTexts: [] })).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("counts case-sensitive whole-name occurrences of each character across all chapters", () => {
    const facts = factsWith((f) => {
      f.characters.push({ name: "Mara Vey" }, { name: "Joren Vey" });
    });
    const chapters = [
      "Mara Vey kept the light. Mara Vey was tired. Mara Veyson watched.",
      "Joren Vey arrived. MARA VEY was spoken to.",
    ];
    const graph = deriveGraphData({ facts, chapterTexts: chapters });
    expect(graph.nodes).toEqual([
      { name: "Mara Vey", importance: 2, role: "protagonist" },
      { name: "Joren Vey", importance: 1, role: "supporting" },
    ]);
    expect(graph.edges).toEqual([]);
  });

  it("honors letter boundaries: a name inside a longer word is not an occurrence", () => {
    const facts = factsWith((f) => {
      f.characters.push({ name: "Ann" });
    });
    const graph = deriveGraphData({
      facts,
      chapterTexts: ["Ann and Anna met Annette."],
    });
    expect(graph.nodes).toEqual([{ name: "Ann", importance: 1, role: "protagonist" }]);
  });

  it("respects regex metacharacters in names", () => {
    const facts = factsWith((f) => {
      f.characters.push({ name: "Bellin (the elder)" });
    });
    const graph = deriveGraphData({
      facts,
      chapterTexts: ["Bellin (the elder) spoke. Bellin the elder did not match."],
    });
    expect(graph.nodes).toEqual([
      { name: "Bellin (the elder)", importance: 1, role: "protagonist" },
    ]);
  });

  it("picks the protagonist by highest importance, ties broken by character order", () => {
    const facts = factsWith((f) => {
      f.characters.push({ name: "A" }, { name: "B" });
    });
    const tied = deriveGraphData({ facts, chapterTexts: ["A saw B. B saw A."] });
    expect(tied.nodes.map((n) => n.role)).toEqual(["protagonist", "supporting"]);

    const swung = deriveGraphData({ facts, chapterTexts: ["B acted alone."] });
    expect(swung.nodes).toEqual([
      { name: "A", importance: 0, role: "supporting" },
      { name: "B", importance: 1, role: "protagonist" },
    ]);
  });

  it("derives one edge per relationship fact", () => {
    const facts = factsWith((f) => {
      f.characters.push({ name: "Mara Vey" }, { name: "Joren Vey" });
      f.relationships.push(
        { from: "Mara Vey", to: "Joren Vey", relationType: "daughter" },
        { from: "Joren Vey", to: "Mara Vey", relationType: "father" },
      );
    });
    const graph = deriveGraphData({ facts, chapterTexts: [] });
    expect(graph.edges).toEqual([
      { from: "Mara Vey", to: "Joren Vey", relation: "daughter" },
      { from: "Joren Vey", to: "Mara Vey", relation: "father" },
    ]);
  });

  it("adds missing relationship endpoints as importance-0 supporting nodes", () => {
    const facts = factsWith((f) => {
      f.characters.push({ name: "Mara Vey" });
      f.relationships.push({ from: "Mara Vey", to: "The Keeper's Council", relationType: "member of" });
    });
    const graph = deriveGraphData({ facts, chapterTexts: ["Mara Vey kept the light."] });
    expect(graph.nodes).toEqual([
      { name: "Mara Vey", importance: 1, role: "protagonist" },
      { name: "The Keeper's Council", importance: 0, role: "supporting" },
    ]);
    expect(graph.edges).toEqual([
      { from: "Mara Vey", to: "The Keeper's Council", relation: "member of" },
    ]);
  });

  it("never emits a top-level protagonist field", () => {
    const graph = deriveGraphData({
      facts: factsWith((f) => f.characters.push({ name: "A" })),
      chapterTexts: [],
    });
    expect(Object.keys(graph)).toEqual(["nodes", "edges"]);
  });
});
