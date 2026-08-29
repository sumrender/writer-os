import { describe, expect, it } from "vitest";
import {
  BIBLE_SECTIONS,
  MODEL_SECTION_KEYS,
  bibleMasterPrompt,
  fakeModelSections,
  validateBible,
} from "./bible-sections.js";
import { emptyStoryBible, emptyWorldSection, storyBibleFromSections } from "./story-bible.js";
import { emptyStoryFacts, type StoryFacts } from "./story-facts.js";
import type { BibleSynthesisInput } from "./pipeline.js";

/**
 * Composition machinery for Story Bible synthesis (issue #14): the section
 * registry (instruction + wire shape + validator + fake per model section),
 * the master prompt assembled from per-section blocks, and the trust-boundary
 * `validateBible` that mirrors the extraction validator's noise-rejection
 * discipline: unknown fields dropped, missing fields rejected, recoverable
 * shapes normalized, `near:` snippets on every rejection, and genuinely
 * ambiguous payloads hard-failing — nothing silently reaches the bible.
 */

/** Canon backing the world section of {@link VALID_PAYLOAD}: one deviating rule. */
const CANON: StoryFacts = {
  ...emptyStoryFacts(),
  worldRules: [{ topic: "the northern light burns without oil" }],
};

const EMPTY_INPUT: BibleSynthesisInput = {
  chapters: [],
  facts: emptyStoryFacts(),
  summaries: [],
};

const VALID_PAYLOAD = {
  book_overview: "A keeper's tale of light and ledgers.",
  world: {
    classification: "hybrid",
    description: "A harbor town where one canon rule deviates from the real world.",
    rules: [
      {
        rule: "the northern light burns without oil",
        relation: "deviates_from_earth",
        note: "Real lamps need oil; the canon light does not.",
      },
    ],
  },
  character_profiles: [{ name: "Mara Vey", profile: "Keeper of the light." }],
  location_profiles: [{ name: "the northern light", profile: "A lighthouse." }],
  thread_rollups: [
    { thread: "the missing ledger", status: "resolved", rollup: "Found and burned." },
  ],
  groups: [{ name: "Keepers", description: "The lighthouse guild." }],
  items_of_significance: [{ name: "brass compass", description: "Points the wrong way." }],
  lexicon_notes: [{ term: "Vess", note: "The keeper family's name." }],
  open_loops: [{ description: "Who burned the ledger?", openedAtOrdinal: 3 }],
  style_rollup: [{ field: "narration", value: "close third person, past tense" }],
  world_timeline: ["the northern light was lit"],
  book_timeline: ["the harbor bell rang", "the ledger burned"],
};

/** The message's `near:` payload snippet, never longer than the extraction cap. */
function nearSnippet(error: unknown): string {
  expect(error).toBeInstanceOf(Error);
  const message = error instanceof Error ? error.message : String(error);
  expect(message).toContain("near:");
  return message.slice(message.indexOf("near:") + "near: ".length);
}

describe("section registry", () => {
  it("covers every model section exactly once with a snake_case wire key", () => {
    expect(MODEL_SECTION_KEYS).toHaveLength(12);
    expect(new Set(MODEL_SECTION_KEYS).size).toBe(12);
    for (const key of MODEL_SECTION_KEYS) {
      expect(BIBLE_SECTIONS[key].key).toBe(key);
      expect(BIBLE_SECTIONS[key].wireKey).toMatch(/^[a-z][a-z_]*$/);
      expect(BIBLE_SECTIONS[key].instruction).not.toBe("");
    }
    expect(MODEL_SECTION_KEYS).toContain("bookOverview");
    expect(MODEL_SECTION_KEYS).toContain("locationProfiles");
  });

  it("ships valid empty placeholders per section, World deriving from the canon", () => {
    const { chapterSummaries: _carried, graph: _derived, ...empty } = emptyStoryBible();
    const sections = fakeModelSections(EMPTY_INPUT);
    expect({ ...sections, world: emptyWorldSection() }).toEqual(empty);
    // The world fake is canon-derived, never an inert placeholder.
    expect(sections.world.classification).toBe("earth");
    expect(sections.world.rules.length).toBeGreaterThan(0);
  });

  it("marks bookOverview a string section, World an object section, the rest arrays", () => {
    for (const key of MODEL_SECTION_KEYS) {
      const schema = BIBLE_SECTIONS[key].wireSchema;
      if (key === "bookOverview") {
        expect(schema).toEqual({ type: "string" });
      } else if (key === "world") {
        expect(schema.type).toBe("object");
        expect(Object.keys((schema as { properties: object }).properties)).toEqual([
          "classification",
          "description",
          "rules",
        ]);
      } else if (key === "worldTimeline" || key === "bookTimeline") {
        expect(schema).toEqual({ type: "array", items: { type: "string" } });
      } else {
        expect(schema).toEqual({ type: "array", items: { type: "object" } });
      }
    }
  });
});

describe("master prompt", () => {
  it("assembles the header plus every section's instruction block", () => {
    const prompt = bibleMasterPrompt();
    expect(prompt).toContain("Story Bible");
    for (const key of MODEL_SECTION_KEYS) {
      expect(prompt).toContain(BIBLE_SECTIONS[key].instruction);
      expect(prompt).toContain(BIBLE_SECTIONS[key].wireKey);
    }
  });
});

describe("per-section trust boundary (via the registry validators)", () => {
  it("validates each section of a well-formed payload", () => {
    for (const key of MODEL_SECTION_KEYS) {
      const wireValue = VALID_PAYLOAD[BIBLE_SECTIONS[key].wireKey as keyof typeof VALID_PAYLOAD];
      expect(BIBLE_SECTIONS[key].validate(wireValue, CANON)).toEqual(
        BIBLE_SECTIONS[key].fake(EMPTY_INPUT) === "" ? VALID_PAYLOAD.book_overview : wireValue,
      );
    }
  });

  it("normalizes bare-string entries into recoverable {identity, secondary} shapes", () => {
    expect(BIBLE_SECTIONS.characterProfiles.validate(["Mara Vey"], CANON)).toEqual([
      { name: "Mara Vey", profile: "" },
    ]);
    expect(BIBLE_SECTIONS.lexiconNotes.validate(["Vess"], CANON)).toEqual([{ term: "Vess", note: "" }]);
    expect(BIBLE_SECTIONS.styleRollup.validate(["narration"], CANON)).toEqual([
      { field: "narration", value: "" },
    ]);
  });

  it("drops unknown fields on entries but keeps the canonical shape", () => {
    expect(
      BIBLE_SECTIONS.groups.validate([{ name: "Keepers", description: "The guild.", color: "red" }], CANON),
    ).toEqual([{ name: "Keepers", description: "The guild." }]);
  });

  it("tolerates an explicit null secondary field as the empty string", () => {
    expect(BIBLE_SECTIONS.locationProfiles.validate([{ name: "the light", profile: null }], CANON)).toEqual([
      { name: "the light", profile: "" },
    ]);
  });

  it("rejects entries missing their identity field", () => {
    expect(() => BIBLE_SECTIONS.groups.validate([{ description: "no name" }], CANON)).toThrow(
      /"name" must be a non-empty string/,
    );
    expect(() => BIBLE_SECTIONS.characterProfiles.validate([{ profile: "no name" }], CANON)).toThrow(
      /"name" must be a non-empty string/,
    );
  });

  it("rejects thread rollups with a missing or invalid status, including bare strings", () => {
    expect(() =>
      BIBLE_SECTIONS.threadRollups.validate([{ thread: "the ledger", rollup: "done" }], CANON),
    ).toThrow(/"status" must be one of open, resolved, dormant/);
    expect(() =>
      BIBLE_SECTIONS.threadRollups.validate([{ thread: "the ledger", status: "cancelled" }], CANON),
    ).toThrow(/"status" must be one of open, resolved, dormant/);
    // A bare string cannot recover the required status — ambiguous, hard fail.
    expect(() => BIBLE_SECTIONS.threadRollups.validate(["the ledger"], CANON)).toThrow(
      /threadRollups: entry #0 must be an object with a non-empty "thread"/,
    );
  });

  it("rejects open loops without a positive openedAtOrdinal", () => {
    expect(() =>
      BIBLE_SECTIONS.openLoops.validate([{ description: "Who burned it?" }], CANON),
    ).toThrow(/"openedAtOrdinal" must be a positive integer/);
    expect(() =>
      BIBLE_SECTIONS.openLoops.validate([{ description: "Who burned it?", openedAtOrdinal: 0 }], CANON),
    ).toThrow(/"openedAtOrdinal" must be a positive integer/);
  });

  it("rejects timeline sections with non-string entries", () => {
    expect(() => BIBLE_SECTIONS.worldTimeline.validate(["fine", 3], CANON)).toThrow(
      /worldTimeline: entry #1 must be a non-empty string/,
    );
    expect(() => BIBLE_SECTIONS.bookTimeline.validate("not an array", CANON)).toThrow(
      /bookTimeline: must be an array of strings/,
    );
  });

  it("hard-fails a string section receiving a non-string value", () => {
    expect(() => BIBLE_SECTIONS.bookOverview.validate(["an", "array"], CANON)).toThrow(
      /bookOverview: must be a string/,
    );
    expect(() => BIBLE_SECTIONS.bookOverview.validate(42, CANON)).toThrow(/bookOverview: must be a string/);
  });

  it("attaches a truncated near: snippet to every rejection", () => {
    const junk = { description: "x".repeat(400) };
    try {
      BIBLE_SECTIONS.itemsOfSignificance.validate([junk, { name: "fine item" }], CANON);
      expect.unreachable("expected a rejection");
    } catch (error) {
      const snippet = nearSnippet(error);
      expect(snippet).toContain('{"description":"');
      expect(snippet.length).toBeLessThanOrEqual(160);
    }
  });
});

describe("validateBible — monolithic trust boundary", () => {
  it("validates a flat wireKey payload into the twelve model sections", () => {
    const sections = validateBible(VALID_PAYLOAD, CANON);
    expect(sections).toEqual({
      bookOverview: VALID_PAYLOAD.book_overview,
      world: VALID_PAYLOAD.world,
      characterProfiles: VALID_PAYLOAD.character_profiles,
      locationProfiles: VALID_PAYLOAD.location_profiles,
      threadRollups: VALID_PAYLOAD.thread_rollups,
      groups: VALID_PAYLOAD.groups,
      itemsOfSignificance: VALID_PAYLOAD.items_of_significance,
      lexiconNotes: VALID_PAYLOAD.lexicon_notes,
      openLoops: VALID_PAYLOAD.open_loops,
      styleRollup: VALID_PAYLOAD.style_rollup,
      worldTimeline: VALID_PAYLOAD.world_timeline,
      bookTimeline: VALID_PAYLOAD.book_timeline,
    });
    expect(storyBibleFromSections(sections, [], { nodes: [], edges: [] })).toEqual({
      ...sections,
      chapterSummaries: [],
      graph: { nodes: [], edges: [] },
    });
  });

  it("drops unknown top-level keys", () => {
    const sections = validateBible({ ...VALID_PAYLOAD, sprouts: 42, bookOverview: "dup" }, CANON);
    expect("sprouts" in sections).toBe(false);
  });

  it("rejects a missing section with the payload snippet", () => {
    const { book_timeline: _missing, ...incomplete } = VALID_PAYLOAD;
    expect(() => validateBible(incomplete, CANON)).toThrow(/missing section "book_timeline"/);
    try {
      validateBible(incomplete, CANON);
      expect.unreachable("expected a rejection");
    } catch (error) {
      expect(nearSnippet(error)).toContain('"book_overview"');
    }
  });

  it("rejects a non-object payload", () => {
    expect(() => validateBible("the whole bible", CANON)).toThrow(/bible: payload must be an object/);
    expect(() => validateBible(null, CANON)).toThrow(/bible: payload must be an object/);
  });

  it("rejects a payload whose section value fails its own validator", () => {
    expect(() =>
      validateBible({ ...VALID_PAYLOAD, groups: [{ description: "no name" }] }, CANON),
    ).toThrow(/groups: entry #0 "name" must be a non-empty string/);
  });
});
