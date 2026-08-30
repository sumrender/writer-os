import { describe, expect, it } from "vitest";
import {
  BIBLE_SECTIONS,
  MODEL_SECTION_KEYS,
  bibleMasterPrompt,
  fakeModelSections,
  validateBible,
} from "./bible-sections.js";
import { emptyStoryBible, storyBibleFromSections } from "./story-bible.js";

/**
 * Composition machinery for Story Bible synthesis (issue #14): the section
 * registry (instruction + wire shape + validator + fake per model section),
 * the master prompt assembled from per-section blocks, and the trust-boundary
 * `validateBible` that mirrors the extraction validator's noise-rejection
 * discipline: unknown fields dropped, missing fields rejected, recoverable
 * shapes normalized, `near:` snippets on every rejection, and genuinely
 * ambiguous payloads hard-failing — nothing silently reaches the bible.
 */

const VALID_PAYLOAD = {
  book_overview: "A keeper's tale of light and ledgers.",
  world: [{ topic: "the northern light", note: "burns without oil" }],
  character_profiles: [{ name: "Mara Vey", profile: "Keeper of the light." }],
  locations: [
    {
      name: "the northern light",
      description: "A lighthouse.",
      significance: "Anchors the keeper's daily round.",
      charactersSeen: [],
    },
  ],
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
    expect(MODEL_SECTION_KEYS).toContain("locations");
  });

  it("ships valid empty placeholders as every section's fake", () => {
    const { chapterSummaries: _carried, graph: _derived, ...sections } = emptyStoryBible();
    expect(fakeModelSections()).toEqual(sections);
  });

  it("marks bookOverview a string section and the other sections arrays of the right item shape", () => {
    for (const key of MODEL_SECTION_KEYS) {
      const schema = BIBLE_SECTIONS[key].wireSchema;
      if (key === "bookOverview") {
        expect(schema).toEqual({ type: "string" });
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
      expect(BIBLE_SECTIONS[key].validate(wireValue)).toEqual(BIBLE_SECTIONS[key].fake() === "" ? VALID_PAYLOAD.book_overview : wireValue);
    }
  });

  it("normalizes bare-string entries into recoverable {identity, secondary} shapes", () => {
    expect(BIBLE_SECTIONS.characterProfiles.validate( ["Mara Vey"])).toEqual([
      { name: "Mara Vey", profile: "" },
    ]);
    expect(BIBLE_SECTIONS.world.validate( ["the northern light burns without oil"])).toEqual([
      { topic: "the northern light burns without oil", note: "" },
    ]);
    expect(BIBLE_SECTIONS.lexiconNotes.validate( ["Vess"])).toEqual([{ term: "Vess", note: "" }]);
    expect(BIBLE_SECTIONS.styleRollup.validate( ["narration"])).toEqual([
      { field: "narration", value: "" },
    ]);
  });

  it("drops unknown fields on entries but keeps the canonical shape", () => {
    expect(
      BIBLE_SECTIONS.groups.validate( [{ name: "Keepers", description: "The guild.", color: "red" }]),
    ).toEqual([{ name: "Keepers", description: "The guild." }]);
  });

  it("tolerates an explicit null secondary field as the empty string", () => {
    expect(BIBLE_SECTIONS.world.validate( [{ topic: "the light", note: null }])).toEqual([
      { topic: "the light", note: "" },
    ]);
    expect(BIBLE_SECTIONS.groups.validate( [{ name: "Keepers", description: null }])).toEqual([
      { name: "Keepers", description: "" },
    ]);
  });

  it("rejects entries missing their identity field", () => {
    expect(() => BIBLE_SECTIONS.groups.validate( [{ description: "no name" }])).toThrow(
      /"name" must be a non-empty string/,
    );
    expect(() => BIBLE_SECTIONS.characterProfiles.validate( [{ profile: "no name" }])).toThrow(
      /"name" must be a non-empty string/,
    );
  });

  it("rejects thread rollups with a missing or invalid status, including bare strings", () => {
    expect(() =>
      BIBLE_SECTIONS.threadRollups.validate( [{ thread: "the ledger", rollup: "done" }]),
    ).toThrow(/"status" must be one of open, resolved, dormant/);
    expect(() =>
      BIBLE_SECTIONS.threadRollups.validate( [{ thread: "the ledger", status: "cancelled" }]),
    ).toThrow(/"status" must be one of open, resolved, dormant/);
    // A bare string cannot recover the required status — ambiguous, hard fail.
    expect(() => BIBLE_SECTIONS.threadRollups.validate( ["the ledger"])).toThrow(
      /threadRollups: entry #0 must be an object with a non-empty "thread"/,
    );
  });

  it("rejects open loops without a positive openedAtOrdinal", () => {
    expect(() =>
      BIBLE_SECTIONS.openLoops.validate( [{ description: "Who burned it?" }]),
    ).toThrow(/"openedAtOrdinal" must be a positive integer/);
    expect(() =>
      BIBLE_SECTIONS.openLoops.validate( [{ description: "Who burned it?", openedAtOrdinal: 0 }]),
    ).toThrow(/"openedAtOrdinal" must be a positive integer/);
  });

  it("rejects timeline sections with non-string entries", () => {
    expect(() => BIBLE_SECTIONS.worldTimeline.validate( ["fine", 3])).toThrow(
      /worldTimeline: entry #1 must be a non-empty string/,
    );
    expect(() => BIBLE_SECTIONS.bookTimeline.validate( "not an array")).toThrow(
      /bookTimeline: must be an array of strings/,
    );
  });

  it("hard-fails a string section receiving a non-string value", () => {
    expect(() => BIBLE_SECTIONS.bookOverview.validate( ["an", "array"])).toThrow(
      /bookOverview: must be a string/,
    );
    expect(() => BIBLE_SECTIONS.bookOverview.validate( 42)).toThrow(/bookOverview: must be a string/);
  });

  it("attaches a truncated near: snippet to every rejection", () => {
    const junk = { description: "x".repeat(400) };
    try {
      BIBLE_SECTIONS.itemsOfSignificance.validate( [junk, { name: "fine item" }]);
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
    const sections = validateBible(VALID_PAYLOAD);
    expect(sections).toEqual({
      bookOverview: VALID_PAYLOAD.book_overview,
      world: VALID_PAYLOAD.world,
      characterProfiles: VALID_PAYLOAD.character_profiles,
      locations: VALID_PAYLOAD.locations,
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
    const sections = validateBible({ ...VALID_PAYLOAD, sprouts: 42, bookOverview: "dup" });
    expect("sprouts" in sections).toBe(false);
  });

  it("rejects a missing section with the payload snippet", () => {
    const { book_timeline: _missing, ...incomplete } = VALID_PAYLOAD;
    expect(() => validateBible(incomplete)).toThrow(/missing section "book_timeline"/);
    try {
      validateBible(incomplete);
      expect.unreachable("expected a rejection");
    } catch (error) {
      expect(nearSnippet(error)).toContain('"book_overview"');
    }
  });

  it("rejects a non-object payload", () => {
    expect(() => validateBible("the whole bible")).toThrow(/bible: payload must be an object/);
    expect(() => validateBible(null)).toThrow(/bible: payload must be an object/);
  });

  it("rejects a payload whose section value fails its own validator", () => {
    expect(() =>
      validateBible({ ...VALID_PAYLOAD, groups: [{ description: "no name" }] }),
    ).toThrow(/groups: entry #0 "name" must be a non-empty string/);
  });
});
