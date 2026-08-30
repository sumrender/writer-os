import { describe, expect, it } from "vitest";
import { emptyStoryFacts, type StoryFacts } from "./story-facts.js";
import {
  coOccurrenceByLocation,
  deriveLocationProfiles,
  knownCharacterNames,
  knownLocationNames,
} from "./bible-locations.js";

/**
 * The per-location derivation (issue #17): for every location the canon
 * establishes, which characters appear there, and the ordinal of their first
 * co-occurrence in the chapter texts. Driven by the chapter-text scan against
 * the location facts; deterministic; mirrors the letter-boundary discipline
 * in `bible-graph.ts`.
 */

function factsWith(
  characters: readonly string[],
  locations: readonly string[],
): StoryFacts {
  return {
    ...emptyStoryFacts(),
    characters: characters.map((name) => ({ name })),
    locations: locations.map((name) => ({ name })),
  };
}

describe("deriveLocationProfiles", () => {
  it("returns one profile per location, with charactersSeen ordered by fact order", () => {
    const facts = factsWith(["Mara Vey", "Joren Vey"], ["the northern light"]);
    const chapters = [
      "Mara Vey tends the northern light on the headland.",
      "Joren Vey visits his daughter at the northern light.",
    ];

    const profiles = deriveLocationProfiles({ facts, chapterTexts: chapters });

    expect(profiles).toEqual([
      {
        name: "the northern light",
        description: "",
        significance: "",
        charactersSeen: [
          { character: "Mara Vey", firstCoOccurrenceOrdinal: 1 },
          { character: "Joren Vey", firstCoOccurrenceOrdinal: 2 },
        ],
      },
    ]);
  });

  it("reports the FIRST chapter ordinal — a later occurrence does not move it", () => {
    const facts = factsWith(["Mara Vey"], ["the northern light"]);
    const chapters = [
      "Mara Vey works on the mainland today.",
      "Mara Vey returns to the northern light at sundown.",
    ];

    const profiles = deriveLocationProfiles({ facts, chapterTexts: chapters });

    expect(profiles[0]?.charactersSeen).toEqual([
      { character: "Mara Vey", firstCoOccurrenceOrdinal: 2 },
    ]);
  });

  it("excludes characters who never share a chapter with the location", () => {
    const facts = factsWith(["Mara Vey", "Joren Vey"], ["the northern light"]);
    const chapters = [
      "Mara Vey walks toward the northern light.",
      "Joren Vey reads in the village square.",
    ];

    const profiles = deriveLocationProfiles({ facts, chapterTexts: chapters });

    expect(profiles[0]?.charactersSeen).toEqual([
      { character: "Mara Vey", firstCoOccurrenceOrdinal: 1 },
    ]);
  });

  it("emits an empty charactersSeen for a location no character ever appears at", () => {
    const facts = factsWith(["Mara Vey"], ["a far country"]);
    const chapters = ["Mara Vey tends the light."];

    const profiles = deriveLocationProfiles({ facts, chapterTexts: chapters });

    expect(profiles[0]?.charactersSeen).toEqual([]);
  });

  it("respects letter boundaries — a name inside a longer word is not an occurrence", () => {
    const facts = factsWith(["Tom"], ["the cave"]);
    const chapters = [
      "Tom entered the cave.",
      "They renamed the cavern, for cavemen had been there first.",
    ];

    const profiles = deriveLocationProfiles({ facts, chapterTexts: chapters });

    expect(profiles[0]?.charactersSeen).toEqual([
      { character: "Tom", firstCoOccurrenceOrdinal: 1 },
    ]);
  });

  it("escapes regex metacharacters in character names — dots and parens are literal", () => {
    const facts = factsWith(["Dr. Smith (Sr.)"], ["the office"]);
    const chapters = [
      "Dr. Smith (Sr.) arrived at the office in a rush.",
      "Dr Smith without the dot stayed home.",
    ];

    const profiles = deriveLocationProfiles({ facts, chapterTexts: chapters });

    expect(profiles[0]?.charactersSeen).toEqual([
      { character: "Dr. Smith (Sr.)", firstCoOccurrenceOrdinal: 1 },
    ]);
  });

  it("escapes regex metacharacters in location names — apostrophes and dots are literal", () => {
    const facts = factsWith(["Tom"], ["McDougal's Cave"]);
    const chapters = [
      "Tom entered McDougal's Cave at midnight.",
      "The caves plural were elsewhere.",
    ];

    const profiles = deriveLocationProfiles({ facts, chapterTexts: chapters });

    expect(profiles[0]?.charactersSeen).toEqual([
      { character: "Tom", firstCoOccurrenceOrdinal: 1 },
    ]);
  });

  it("is deterministic — identical inputs produce deep-equal profiles", () => {
    const facts = factsWith(["Mara Vey", "Joren Vey"], ["the northern light", "the harbor"]);
    const chapters = [
      "Mara Vey walks to the northern light.",
      "Joren Vey meets her at the northern light.",
      "Both walk down to the harbor.",
    ];

    const a = deriveLocationProfiles({ facts, chapterTexts: chapters });
    const b = deriveLocationProfiles({ facts, chapterTexts: chapters });

    expect(a).toEqual(b);
  });

  it("emits zero profiles when the canon establishes no locations", () => {
    const facts = factsWith(["Mara Vey"], []);
    const chapters = ["Mara Vey tends the light."];

    const profiles = deriveLocationProfiles({ facts, chapterTexts: chapters });

    expect(profiles).toEqual([]);
  });
});

describe("coOccurrenceByLocation", () => {
  it("maps every profile name to its charactersSeen, including empty arrays", () => {
    const profiles = [
      {
        name: "the northern light",
        description: "",
        significance: "",
        charactersSeen: [
          { character: "Mara Vey", firstCoOccurrenceOrdinal: 1 },
        ],
      },
      {
        name: "a far country",
        description: "",
        significance: "",
        charactersSeen: [],
      },
    ];

    const map = coOccurrenceByLocation(profiles);

    expect(map.size).toBe(2);
    expect(map.get("the northern light")).toEqual([
      { character: "Mara Vey", firstCoOccurrenceOrdinal: 1 },
    ]);
    expect(map.get("a far country")).toEqual([]);
  });

  it("returns an empty map when there are no profiles", () => {
    const map = coOccurrenceByLocation([]);
    expect(map.size).toBe(0);
  });
});

describe("knownLocationNames / knownCharacterNames", () => {
  it("builds a name lookup set from the location facts", () => {
    const facts = factsWith([], ["a", "b", "c"]);
    expect(knownLocationNames(facts)).toEqual(new Set(["a", "b", "c"]));
  });

  it("builds a name lookup set from the character facts", () => {
    const facts = factsWith(["Mara Vey", "Joren Vey"], []);
    expect(knownCharacterNames(facts)).toEqual(new Set(["Mara Vey", "Joren Vey"]));
  });

  it("returns an empty set when the canon is empty", () => {
    const facts = emptyStoryFacts();
    expect(knownLocationNames(facts).size).toBe(0);
    expect(knownCharacterNames(facts).size).toBe(0);
  });
});
