import { describe, expect, it } from "vitest";
import {
  BIBLE_SECTIONS,
  MODEL_SECTION_KEYS,
  bibleMasterPrompt,
  fakeModelSections,
  validateBible,
} from "./bible-sections.js";
import { emptyBookOverview, emptyStoryBible, storyBibleFromSections } from "./story-bible.js";
import { emptyStoryFacts, type StoryFacts } from "./story-facts.js";

/**
 * Composition machinery for Story Bible synthesis (issues #14/#19): the
 * section registry (instruction + wire shape + validator + fake per model
 * section), the master prompt assembled from per-section blocks, and the
 * trust-boundary `validateBible` that mirrors the extraction validator's
 * noise-rejection discipline: unknown fields dropped, missing fields rejected,
 * recoverable shapes normalized, `near:` snippets on every rejection, and
 * genuinely ambiguous payloads hard-failing — nothing silently reaches the
 * bible. The overview and thread-rollup sections additionally validate their
 * content against the graded Story Facts (issue #19): no invented threads,
 * plot events, or status changes without a fact-layer basis.
 */

/** The canon a payload's overview/rollups must be grounded in. */
const VALID_CANON: StoryFacts = {
  ...emptyStoryFacts(),
  characters: [{ name: "Mara Vey" }],
  locations: [{ name: "the northern light" }],
  threads: [{ thread: "the missing ledger", status: "resolved" }],
};

const VALID_PAYLOAD = {
  book_overview: {
    title: "The Brass Compass",
    genre: "keeper's tale",
    era: "the age of the light",
    setting: "the northern light",
    premise: "A keeper's tale of light and ledgers.",
    synopsis: "the harbor bell rang. plot thread \"the missing ledger\" stands resolved",
    themes: "light and ledgers",
  },
  world: [{ topic: "the northern light", note: "burns without oil" }],
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

  it("ships valid empty placeholders as every section's fake", () => {
    const { chapterSummaries: _carried, graph: _derived, ...sections } = emptyStoryBible();
    expect(fakeModelSections()).toEqual(sections);
  });

  it("marks bookOverview an object section and the other sections arrays of the right item shape", () => {
    for (const key of MODEL_SECTION_KEYS) {
      const schema = BIBLE_SECTIONS[key].wireSchema;
      if (key === "bookOverview") {
        expect(schema).toEqual({
          type: "object",
          properties: {
            title: { type: "string" },
            genre: { type: "string" },
            era: { type: "string" },
            setting: { type: "string" },
            premise: { type: "string" },
            synopsis: { type: "string" },
            themes: { type: "string" },
          },
        });
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
  it("validates each section of a well-formed payload against the same canon", () => {
    for (const key of MODEL_SECTION_KEYS) {
      const wireValue = VALID_PAYLOAD[BIBLE_SECTIONS[key].wireKey as keyof typeof VALID_PAYLOAD];
      expect(BIBLE_SECTIONS[key].validate(wireValue, VALID_CANON)).toEqual(wireValue);
    }
  });

  it("normalizes bare-string entries into recoverable {identity, secondary} shapes", () => {
    expect(BIBLE_SECTIONS.characterProfiles.validate( ["Mara Vey"], VALID_CANON)).toEqual([
      { name: "Mara Vey", profile: "" },
    ]);
    expect(BIBLE_SECTIONS.world.validate( ["the northern light burns without oil"], VALID_CANON)).toEqual([
      { topic: "the northern light burns without oil", note: "" },
    ]);
    expect(BIBLE_SECTIONS.lexiconNotes.validate( ["Vess"], VALID_CANON)).toEqual([{ term: "Vess", note: "" }]);
    expect(BIBLE_SECTIONS.styleRollup.validate( ["narration"], VALID_CANON)).toEqual([
      { field: "narration", value: "" },
    ]);
  });

  it("drops unknown fields on entries but keeps the canonical shape", () => {
    expect(
      BIBLE_SECTIONS.groups.validate( [{ name: "Keepers", description: "The guild.", color: "red" }], VALID_CANON),
    ).toEqual([{ name: "Keepers", description: "The guild." }]);
  });

  it("tolerates an explicit null secondary field as the empty string", () => {
    expect(BIBLE_SECTIONS.locationProfiles.validate( [{ name: "the light", profile: null }], VALID_CANON)).toEqual([
      { name: "the light", profile: "" },
    ]);
  });

  it("rejects entries missing their identity field", () => {
    expect(() => BIBLE_SECTIONS.groups.validate( [{ description: "no name" }], VALID_CANON)).toThrow(
      /"name" must be a non-empty string/,
    );
    expect(() => BIBLE_SECTIONS.characterProfiles.validate( [{ profile: "no name" }], VALID_CANON)).toThrow(
      /"name" must be a non-empty string/,
    );
  });

  it("rejects thread rollups with a missing or invalid status, including bare strings", () => {
    expect(() =>
      BIBLE_SECTIONS.threadRollups.validate( [{ thread: "the ledger", rollup: "done" }], VALID_CANON),
    ).toThrow(/"status" must be one of open, resolved, dormant/);
    expect(() =>
      BIBLE_SECTIONS.threadRollups.validate( [{ thread: "the ledger", status: "cancelled" }], VALID_CANON),
    ).toThrow(/"status" must be one of open, resolved, dormant/);
    // A bare string cannot recover the required status — ambiguous, hard fail.
    expect(() => BIBLE_SECTIONS.threadRollups.validate( ["the ledger"], VALID_CANON)).toThrow(
      /threadRollups: entry #0 must be an object with a non-empty "thread"/,
    );
  });

  it("rejects open loops without a positive openedAtOrdinal", () => {
    expect(() =>
      BIBLE_SECTIONS.openLoops.validate( [{ description: "Who burned it?" }], VALID_CANON),
    ).toThrow(/"openedAtOrdinal" must be a positive integer/);
    expect(() =>
      BIBLE_SECTIONS.openLoops.validate( [{ description: "Who burned it?", openedAtOrdinal: 0 }], VALID_CANON),
    ).toThrow(/"openedAtOrdinal" must be a positive integer/);
  });

  it("rejects timeline sections with non-string entries", () => {
    expect(() => BIBLE_SECTIONS.worldTimeline.validate( ["fine", 3], VALID_CANON)).toThrow(
      /worldTimeline: entry #1 must be a non-empty string/,
    );
    expect(() => BIBLE_SECTIONS.bookTimeline.validate( "not an array", VALID_CANON)).toThrow(
      /bookTimeline: must be an array of strings/,
    );
  });

  it("hard-fails the overview section receiving a non-object value", () => {
    expect(() => BIBLE_SECTIONS.bookOverview.validate( ["an", "array"], VALID_CANON)).toThrow(
      /bookOverview: must be an object with string fields/,
    );
    expect(() => BIBLE_SECTIONS.bookOverview.validate( 42, VALID_CANON)).toThrow(
      /bookOverview: must be an object with string fields/,
    );
    expect(() =>
      BIBLE_SECTIONS.bookOverview.validate( { title: "The Brass Compass", setting: 4 }, VALID_CANON),
    ).toThrow(/"setting" must be a string/);
  });

  it("attaches a truncated near: snippet to every rejection", () => {
    const junk = { description: "x".repeat(400) };
    try {
      BIBLE_SECTIONS.itemsOfSignificance.validate( [junk, { name: "fine item" }], VALID_CANON);
      expect.unreachable("expected a rejection");
    } catch (error) {
      const snippet = nearSnippet(error);
      expect(snippet).toContain('{"description":"');
      expect(snippet.length).toBeLessThanOrEqual(160);
    }
  });
});

describe("canon-grounded validators (issue #19)", () => {
  const overview = (synopsis: string) => ({
    title: "The Brass Compass",
    genre: "keeper's tale",
    era: "the age of the light",
    setting: "the northern light",
    premise: "A keeper's tale of light and ledgers.",
    synopsis,
    themes: "light and ledgers",
  });

  it("rejects an overview asserting a thread status the canon has not established", () => {
    expect(() =>
      BIBLE_SECTIONS.bookOverview.validate(
        { ...overview("all quiet"), premise: 'plot thread "the buried ransom" stands open' },
        VALID_CANON,
      ),
    ).toThrow(/thread "the buried ransom" is not established in canon/);
  });

  it("rejects an overview that resolves a thread the fact layer still holds open", () => {
    const canon = {
      ...emptyStoryFacts(),
      threads: [{ thread: "the missing ledger", status: "open" as const }],
    };
    expect(() =>
      BIBLE_SECTIONS.bookOverview.validate(
        overview('plot thread "the missing ledger" stands resolved'),
        canon,
      ),
    ).toThrow(/thread "the missing ledger" is asserted "resolved" but canon establishes "open"/);
  });

  it("rejects a populated overview when the canon establishes nothing yet", () => {
    expect(() =>
      BIBLE_SECTIONS.bookOverview.validate(overview("the harbor bell rang"), emptyStoryFacts()),
    ).toThrow(/canon establishes nothing; the overview must be empty/);
  });

  it("accepts an empty overview for an unestablished canon", () => {
    expect(BIBLE_SECTIONS.bookOverview.validate({}, emptyStoryFacts())).toEqual(emptyBookOverview());
  });

  it("rejects a thread rollup for a thread the canon does not establish", () => {
    expect(() =>
      BIBLE_SECTIONS.threadRollups.validate(
        [{ thread: "the buried ransom", status: "open", rollup: "dug up." }],
        VALID_CANON,
      ),
    ).toThrow(/thread "the buried ransom" is not established in canon/);
  });

  it("rejects a rollup whose status contradicts the fact layer", () => {
    expect(() =>
      BIBLE_SECTIONS.threadRollups.validate(
        [{ thread: "the missing ledger", status: "open", rollup: "Still missing." }],
        VALID_CANON,
      ),
    ).toThrow(/thread "the missing ledger" is asserted "open" but canon establishes "resolved"/);
  });

  it("rejects any rollup when the canon has no threads at all", () => {
    expect(() =>
      BIBLE_SECTIONS.threadRollups.validate(
        [{ thread: "the missing ledger", status: "open", rollup: "Still missing." }],
        emptyStoryFacts(),
      ),
    ).toThrow(/no threads established in canon; rollups must be empty/);
  });

  it("rejects a rollup prose that contradicts the canon even when the fields match", () => {
    expect(() =>
      BIBLE_SECTIONS.threadRollups.validate(
        [
          {
            thread: "the missing ledger",
            status: "resolved",
            rollup: 'plot thread "the missing ledger" stands open',
          },
        ],
        VALID_CANON,
      ),
    ).toThrow(/thread "the missing ledger" is asserted "open" but canon establishes "resolved"/);
  });
});

describe("validateBible — monolithic trust boundary", () => {
  it("validates a flat wireKey payload into the twelve model sections", () => {
    const sections = validateBible(VALID_PAYLOAD, VALID_CANON);
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
    const sections = validateBible({ ...VALID_PAYLOAD, sprouts: 42, bookOverview: "dup" }, VALID_CANON);
    expect("sprouts" in sections).toBe(false);
  });

  it("rejects a missing section with the payload snippet", () => {
    const { book_timeline: _missing, ...incomplete } = VALID_PAYLOAD;
    expect(() => validateBible(incomplete, VALID_CANON)).toThrow(/missing section "book_timeline"/);
    try {
      validateBible(incomplete, VALID_CANON);
      expect.unreachable("expected a rejection");
    } catch (error) {
      expect(nearSnippet(error)).toContain('"book_overview"');
    }
  });

  it("rejects a non-object payload", () => {
    expect(() => validateBible("the whole bible", VALID_CANON)).toThrow(/bible: payload must be an object/);
    expect(() => validateBible(null, VALID_CANON)).toThrow(/bible: payload must be an object/);
  });

  it("rejects a payload whose section value fails its own validator", () => {
    expect(() =>
      validateBible({ ...VALID_PAYLOAD, groups: [{ description: "no name" }] }, VALID_CANON),
    ).toThrow(/groups: entry #0 "name" must be a non-empty string/);
  });
});
describe("canon-grounded fakes (issue #19)", () => {
  const synthContext = () => ({
    facts: {
      ...emptyStoryFacts(),
      characters: [{ name: "Mara Vey" }, { name: "Joren Vey" }],
      locations: [{ name: "the northern light" }],
      items: [{ item: "brass compass", holder: "Mara Vey" }],
      threads: [{ thread: "the missing ledger", status: "open" as const }],
      timeline: ["the harbor bell rang"],
    },
    summaries: [
      { ordinal: 2, summary: 'plot thread "the missing ledger" stands open' },
    ],
  });

  it("derives a populated overview once the canon is established and empty before", () => {
    const sections = fakeModelSections(synthContext());
    expect(sections.bookOverview).toEqual({
      title: "The Northern Light",
      genre: "unstated by the canon",
      era: "unstated by the canon",
      setting: "the northern light",
      premise: 'The tale of Mara Vey and the matter of "the missing ledger".',
      synopsis: 'the harbor bell rang. plot thread "the missing ledger" stands open.',
      themes: "brass compass",
    });
    expect(fakeModelSections().bookOverview).toEqual(emptyBookOverview());
  });

  it("grounds every overview field in canon tokens only", () => {
    const overview = fakeModelSections(synthContext()).bookOverview;
    for (const value of Object.values(overview)) {
      expect(value).not.toBe("");
    }
    // Every non-placeholder phrase references only established canon names.
    expect(overview.setting).toContain("the northern light");
    expect(overview.premise).toContain("Mara Vey");
    expect(overview.synopsis).toContain("the harbor bell rang");
  });

  it("derives thread rollups mirroring the fact-layer status and arc", () => {
    const sections = fakeModelSections(synthContext());
    expect(sections.threadRollups).toEqual([
      {
        thread: "the missing ledger",
        status: "open",
        rollup: "Opened by chapter 2 and still open as of chapter 2.",
      },
    ]);
  });

  it("keeps the synopsis per-ordinal: no later events at an early ordinal", () => {
    const early = fakeModelSections({
      facts: {
        ...emptyStoryFacts(),
        characters: [{ name: "Mara Vey" }],
        locations: [{ name: "the northern light" }],
        timeline: ["the harbor bell rang"],
      },
      summaries: [],
    }).bookOverview;
    expect(early.synopsis).toBe("the harbor bell rang.");
    expect(early.synopsis).not.toContain("burned");
    expect(early.synopsis).not.toContain("resolved");
  });

  it("is deterministic: identical contexts produce deep-equal sections", () => {
    const context = synthContext();
    expect(fakeModelSections(context)).toEqual(fakeModelSections(synthContext()));
  });

  it("produces fake output that passes the canon-grounded validators", () => {
    const context = synthContext();
    const sections = fakeModelSections(context);
    expect(validateBible(
      {
        book_overview: sections.bookOverview,
        world: sections.world,
        character_profiles: sections.characterProfiles,
        location_profiles: sections.locationProfiles,
        thread_rollups: sections.threadRollups,
        groups: sections.groups,
        items_of_significance: sections.itemsOfSignificance,
        lexicon_notes: sections.lexiconNotes,
        open_loops: sections.openLoops,
        style_rollup: sections.styleRollup,
        world_timeline: sections.worldTimeline,
        book_timeline: sections.bookTimeline,
      },
      context.facts,
    )).toEqual(sections);
  });
});
