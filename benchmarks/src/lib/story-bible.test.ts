import { describe, expect, it } from "vitest";
import {
  BIBLE_SECTIONS,
  MODEL_SECTION_KEYS,
  bibleMasterPrompt,
  fakeModelSections,
  validateBible,
} from "./bible-sections.js";
import {
  emptyBookOverview,
  emptyStoryBible,
  emptyWorldSection,
  storyBibleFromSections,
  type SectionCanon,
} from "./story-bible.js";
import { emptyStoryFacts } from "./story-facts.js";

/**
 * Composition machinery for Story Bible synthesis (issue #14): the section
 * registry (instruction + wire shape + validator + fake per model section),
 * the master prompt assembled from per-section blocks, and the trust-boundary
 * `validateBible` that mirrors the extraction validator's noise-rejection
 * discipline: unknown fields dropped, missing fields rejected, recoverable
 * shapes normalized, `near:` snippets on every rejection, and genuinely
 * ambiguous payloads hard-failing — nothing silently reaches the bible.
 * Since issue #15 every validator and fake also grounds against the section
 * canon (facts + summaries), so the tests validate against a canon too. The
 * overview and thread-rollup sections additionally validate their content
 * against the graded Story Facts (issue #19): no invented threads, plot
 * events, or status changes without a fact-layer basis.
 */

/** Canon backing {@link VALID_PAYLOAD}: one deviating world rule, the
 * characters its character profiles are grounded in, and the thread its
 * overview and thread rollups assert (issue #19). */
const CANON: SectionCanon = {
  facts: {
    ...emptyStoryFacts(),
    characters: [{ name: "Mara Vey" }],
    relationships: [{ from: "Mara Vey", to: "Joren Vey", relationType: "daughter" }],
    locations: [{ name: "the northern light" }],
    threads: [{ thread: "the missing ledger", status: "resolved" }],
    worldRules: [{ topic: "the northern light burns without oil" }],
  },
  chapterSummaries: [{ ordinal: 1, summary: "Mara Vey keeps the light; Joren Vey visits." }],
};

const EMPTY_CANON: SectionCanon = { facts: emptyStoryFacts(), chapterSummaries: [] };

const VALID_PAYLOAD = {
  book_overview: {
    title: "The Brass Compass",
    genre: "keeper's tale",
    era: "the age of the light",
    setting: "the northern light",
    premise: "A keeper's tale of light and ledgers.",
    synopsis: 'the harbor bell rang. plot thread "the missing ledger" stands resolved',
    themes: "light and ledgers",
  },
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
  character_profiles: [
    {
      name: "Mara Vey",
      appearance: "her coat: salt-white wool.",
      personality: "steady, watchful",
      definingTraits: ["keeper's resolve"],
      background: "raised in the light",
      arc: "keeper's daughter to keeper",
      firstAppearanceOrdinal: 1,
      mentionOrdinals: [1],
      relationships: [
        { other: "Joren Vey", summary: "Mara Vey is the daughter of Joren Vey." },
      ],
    },
  ],
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
  world_timeline: [{ event: "the northern light was lit", grounding: "stated" }],
  book_timeline: [
    { ordinal: 1, events: ["the harbor bell rang"] },
    { ordinal: 3, events: ["the ledger burned"] },
  ],
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

  it("ships valid empty placeholders per section, World deriving from the canon", () => {
    const { chapterSummaries: _carried, graph: _derived, ...empty } = emptyStoryBible();
    const sections = fakeModelSections(EMPTY_CANON);
    expect({ ...sections, world: emptyWorldSection() }).toEqual(empty);
    // The world fake is canon-derived, never an inert placeholder.
    expect(sections.world.classification).toBe("earth");
    expect(sections.world.rules.length).toBeGreaterThan(0);
  });

  it("populates character profiles from a canon that establishes characters", () => {
    const sections = fakeModelSections(CANON);
    expect(sections.characterProfiles.map((p) => p.name)).toEqual(["Mara Vey"]);
    expect(sections.characterProfiles[0]?.mentionOrdinals).toEqual([1]);
    // Every other section the canon establishes nothing for stays empty.
    expect(sections.locations).toEqual([]);
  });

  it("marks bookOverview and World object sections, the rest arrays of objects", () => {
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
      } else if (key === "world") {
        if (schema.type !== "object") {
          throw new Error("world wire schema must be an object section");
        }
        expect(Object.keys(schema.properties ?? {})).toEqual([
          "classification",
          "description",
          "rules",
        ]);
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
      expect(BIBLE_SECTIONS[key].validate(wireValue, CANON)).toEqual(wireValue);
    }
  });

  it("normalizes bare-string entries into recoverable {identity, secondary} shapes", () => {
    expect(BIBLE_SECTIONS.lexiconNotes.validate(["Vess"], CANON)).toEqual([
      { term: "Vess", note: "" },
    ]);
    expect(BIBLE_SECTIONS.styleRollup.validate(["narration"], CANON)).toEqual([
      { field: "narration", value: "" },
    ]);
  });

  it("rejects bare strings for character profiles — the rich shape is not recoverable", () => {
    expect(() => BIBLE_SECTIONS.characterProfiles.validate(["Mara Vey"], CANON)).toThrow(
      /characterProfiles: entry #0 must be an object with a non-empty "name"/,
    );
  });

  it("drops unknown fields on entries but keeps the canonical shape", () => {
    expect(
      BIBLE_SECTIONS.groups.validate([{ name: "Keepers", description: "The guild.", color: "red" }], CANON),
    ).toEqual([{ name: "Keepers", description: "The guild." }]);
  });

  it("tolerates an explicit null secondary field as the empty string", () => {
    expect(BIBLE_SECTIONS.groups.validate([{ name: "Keepers", description: null }], CANON)).toEqual([
      { name: "Keepers", description: "" },
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

  it("rejects worldTimeline with non-object entries and invalid grounding", () => {
    expect(() => BIBLE_SECTIONS.worldTimeline.validate(["fine"], CANON)).toThrow(
      /worldTimeline: entry #0 must be an object/,
    );
    expect(() =>
      BIBLE_SECTIONS.worldTimeline.validate([{ event: "the light was lit" }], CANON),
    ).toThrow(/"grounding" must be one of stated, inferred/);
    expect(() =>
      BIBLE_SECTIONS.worldTimeline.validate([{ event: "", grounding: "stated" }], CANON),
    ).toThrow(/"event" must be a non-empty string/);
  });

  it("rejects bookTimeline with non-object entries and missing ordinal", () => {
    expect(() => BIBLE_SECTIONS.bookTimeline.validate("not an array", CANON)).toThrow(
      /bookTimeline: must be an array of \{ordinal, events\} entries/,
    );
    expect(() => BIBLE_SECTIONS.bookTimeline.validate([{ events: ["x"] }], CANON)).toThrow(
      /"ordinal" must be a positive integer/,
    );
    expect(() =>
      BIBLE_SECTIONS.bookTimeline.validate([{ ordinal: 1, events: [3] }], CANON),
    ).toThrow(/bookTimeline\[1\]events: entry #0 must be a non-empty string/);
  });

  it("hard-fails the overview section receiving a non-object value", () => {
    expect(() => BIBLE_SECTIONS.bookOverview.validate(["an", "array"], CANON)).toThrow(
      /bookOverview: must be an object with string fields/,
    );
    expect(() => BIBLE_SECTIONS.bookOverview.validate(42, CANON)).toThrow(
      /bookOverview: must be an object with string fields/,
    );
    expect(() =>
      BIBLE_SECTIONS.bookOverview.validate({ title: "The Brass Compass", setting: 4 }, CANON),
    ).toThrow(/"setting" must be a string/);
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
        CANON,
      ),
    ).toThrow(/thread "the buried ransom" is not established in canon/);
  });

  it("rejects an overview that resolves a thread the fact layer still holds open", () => {
    const openCanon: SectionCanon = {
      facts: {
        ...emptyStoryFacts(),
        threads: [{ thread: "the missing ledger", status: "open" }],
      },
      chapterSummaries: [],
    };
    expect(() =>
      BIBLE_SECTIONS.bookOverview.validate(
        overview('plot thread "the missing ledger" stands resolved'),
        openCanon,
      ),
    ).toThrow(/thread "the missing ledger" is asserted "resolved" but canon establishes "open"/);
  });

  it("rejects a populated overview when the canon establishes nothing yet", () => {
    expect(() =>
      BIBLE_SECTIONS.bookOverview.validate(overview("the harbor bell rang"), EMPTY_CANON),
    ).toThrow(/canon establishes nothing; the overview must be empty/);
  });

  it("accepts an empty overview for an unestablished canon", () => {
    expect(BIBLE_SECTIONS.bookOverview.validate({}, EMPTY_CANON)).toEqual(emptyBookOverview());
  });

  it("rejects a thread rollup for a thread the canon does not establish", () => {
    expect(() =>
      BIBLE_SECTIONS.threadRollups.validate(
        [{ thread: "the buried ransom", status: "open", rollup: "dug up." }],
        CANON,
      ),
    ).toThrow(/thread "the buried ransom" is not established in canon/);
  });

  it("rejects a rollup whose status contradicts the fact layer", () => {
    expect(() =>
      BIBLE_SECTIONS.threadRollups.validate(
        [{ thread: "the missing ledger", status: "open", rollup: "Still missing." }],
        CANON,
      ),
    ).toThrow(/thread "the missing ledger" is asserted "open" but canon establishes "resolved"/);
  });

  it("rejects any rollup when the canon has no threads at all", () => {
    expect(() =>
      BIBLE_SECTIONS.threadRollups.validate(
        [{ thread: "the missing ledger", status: "open", rollup: "Still missing." }],
        EMPTY_CANON,
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
        CANON,
      ),
    ).toThrow(/thread "the missing ledger" is asserted "open" but canon establishes "resolved"/);
  });
});

describe("validateBible — monolithic trust boundary", () => {
  it("validates a flat wireKey payload into the twelve model sections", () => {
    const sections = validateBible(VALID_PAYLOAD, CANON);
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
      worldTimeline: [{ event: "the northern light was lit", grounding: "stated" }],
      bookTimeline: [
        { ordinal: 1, events: ["the harbor bell rang"] },
        { ordinal: 3, events: ["the ledger burned"] },
      ],
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

  it("rejects character profiles that introduce unsourced entities (canon-grounded)", () => {
    expect(() =>
      validateBible(
        {
          ...VALID_PAYLOAD,
          character_profiles: [
            { ...VALID_PAYLOAD.character_profiles[0], name: "Bellin the harbormaster" },
          ],
        },
        CANON,
      ),
    ).toThrow(/introduces unsourced character "Bellin the harbormaster"/);
  });
});

describe("canon-grounded fakes (issue #19)", () => {
  const synthCanon = (): SectionCanon => ({
    facts: {
      ...emptyStoryFacts(),
      characters: [{ name: "Mara Vey" }, { name: "Joren Vey" }],
      locations: [{ name: "the northern light" }],
      items: [{ item: "brass compass", holder: "Mara Vey" }],
      threads: [{ thread: "the missing ledger", status: "open" as const }],
      timeline: ["the harbor bell rang"],
    },
    chapterSummaries: [
      { ordinal: 1, summary: "Mara Vey and Joren Vey arrive at the light." },
      {
        ordinal: 2,
        summary: 'Mara Vey and Joren Vey watch as plot thread "the missing ledger" stands open',
      },
    ],
  });

  it("derives a populated overview once the canon is established and empty before", () => {
    const sections = fakeModelSections(synthCanon());
    expect(sections.bookOverview).toEqual({
      title: "The Northern Light",
      genre: "unstated by the canon",
      era: "unstated by the canon",
      setting: "the northern light",
      premise: 'The tale of Mara Vey and the matter of "the missing ledger".',
      synopsis: 'the harbor bell rang. plot thread "the missing ledger" stands open.',
      themes: "brass compass",
    });
    expect(fakeModelSections(EMPTY_CANON).bookOverview).toEqual(emptyBookOverview());
  });

  it("grounds every overview field in canon tokens only", () => {
    const overview = fakeModelSections(synthCanon()).bookOverview;
    for (const value of Object.values(overview)) {
      expect(value).not.toBe("");
    }
    // Every non-placeholder phrase references only established canon names.
    expect(overview.setting).toContain("the northern light");
    expect(overview.premise).toContain("Mara Vey");
    expect(overview.synopsis).toContain("the harbor bell rang");
  });

  it("derives thread rollups mirroring the fact-layer status and arc", () => {
    const sections = fakeModelSections(synthCanon());
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
      chapterSummaries: [],
    }).bookOverview;
    expect(early.synopsis).toBe("the harbor bell rang.");
    expect(early.synopsis).not.toContain("burned");
    expect(early.synopsis).not.toContain("resolved");
  });

  it("is deterministic: identical canons produce deep-equal sections", () => {
    expect(fakeModelSections(synthCanon())).toEqual(fakeModelSections(synthCanon()));
  });

  it("produces fake output that passes the canon-grounded validators", () => {
    const canon = synthCanon();
    const sections = fakeModelSections(canon);
    expect(
      validateBible(
        {
          book_overview: sections.bookOverview,
          world: sections.world,
          character_profiles: sections.characterProfiles,
          locations: sections.locations,
          thread_rollups: sections.threadRollups,
          groups: sections.groups,
          items_of_significance: sections.itemsOfSignificance,
          lexicon_notes: sections.lexiconNotes,
          open_loops: sections.openLoops,
          style_rollup: sections.styleRollup,
          world_timeline: sections.worldTimeline,
          book_timeline: sections.bookTimeline,
        },
        canon,
      ),
    ).toEqual(sections);
  });
});
