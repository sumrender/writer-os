import { describe, expect, it } from "vitest";
import { emptyStoryFacts, type StoryFacts } from "./story-facts.js";
import type { CharacterProfile, SectionCanon } from "./story-bible.js";
import { fakeCharacterProfiles, validateCharacterProfiles } from "./character-profiles.js";

/**
 * The character-profile slice of the Story Bible (issue #15): the
 * trust-boundary validator and the deterministic fake generator, in
 * isolation. Good shapes are accepted, noise is rejected with `near:`
 * snippets, and the fake is deterministic, canon-grounded, and always
 * accepted by its own validator.
 */

/** Mini-book-shaped canon: hand-computable, exactly what fake extraction yields. */
const MINI_FACTS: StoryFacts = {
  ...emptyStoryFacts(),
  characters: [{ name: "Mara Vey" }, { name: "Joren Vey" }],
  appearances: [
    { character: "Mara Vey", attribute: "her coat", contains: "salt-white wool" },
  ],
  relationships: [
    { from: "Mara Vey", to: "Joren Vey", relationType: "daughter" },
    { from: "Joren Vey", to: "Mara Vey", relationType: "father" },
  ],
};

const MINI_SUMMARIES = [
  {
    ordinal: 1,
    summary:
      'character named "Mara Vey"; character named "Joren Vey"; "Mara Vey" — her coat: salt-white wool; "Mara Vey" is the "daughter" of "Joren Vey"',
  },
  { ordinal: 2, summary: 'item "brass compass" is held by "Mara Vey"' },
  { ordinal: 3, summary: "world rule: the northern light burns without oil" },
  { ordinal: 4, summary: '"Joren Vey" is the "father" of "Mara Vey"' },
];

const CANON: SectionCanon = { facts: MINI_FACTS, chapterSummaries: MINI_SUMMARIES };

const EMPTY_CANON: SectionCanon = { facts: emptyStoryFacts(), chapterSummaries: [] };

/** A canon establishing only Mara, for cases that profile her alone. */
const MARA_CANON: SectionCanon = {
  facts: { ...MINI_FACTS, characters: [{ name: "Mara Vey" }] },
  chapterSummaries: MINI_SUMMARIES,
};

const MARA_PROFILE: CharacterProfile = {
  name: "Mara Vey",
  appearance: "her coat: salt-white wool",
  personality: "steady, watchful",
  definingTraits: ["keeper's resolve"],
  background: "raised in the northern light",
  arc: "from keeper's daughter to keeper",
  firstAppearanceOrdinal: 1,
  mentionOrdinals: [1, 2, 4],
  relationships: [{ other: "Joren Vey", summary: "Mara Vey is the daughter of Joren Vey." }],
};

/** The message's `near:` payload snippet, never longer than the extraction cap. */
function nearSnippet(error: unknown): string {
  expect(error).toBeInstanceOf(Error);
  const message = error instanceof Error ? error.message : String(error);
  expect(message).toContain("near:");
  return message.slice(message.indexOf("near:") + "near: ".length);
}

describe("validateCharacterProfiles — shape", () => {
  it("accepts a well-formed grounded profile and drops unknown fields", () => {
    expect(
      validateCharacterProfiles(
        [{ ...MARA_PROFILE, invented: "noise" }],
        MARA_CANON,
      ),
    ).toEqual([MARA_PROFILE]);
  });

  it("normalizes prose aspects canon may not establish to empty strings", () => {
    expect(
      validateCharacterProfiles(
        [{ name: "Mara Vey", firstAppearanceOrdinal: 1, mentionOrdinals: [1] }],
        MARA_CANON,
      ),
    ).toEqual([
      {
        ...MARA_PROFILE,
        appearance: "",
        personality: "",
        definingTraits: [],
        background: "",
        arc: "",
        mentionOrdinals: [1],
        relationships: [],
      },
    ]);
  });

  it("normalizes null prose fields and tolerates a null relationship list", () => {
    expect(
      validateCharacterProfiles(
        [
          {
            name: "Mara Vey",
            appearance: null,
            personality: null,
            background: null,
            arc: null,
            definingTraits: null,
            relationships: null,
            firstAppearanceOrdinal: 1,
            mentionOrdinals: [1],
          },
        ],
        MARA_CANON,
      ),
    ).toEqual([
      {
        ...MARA_PROFILE,
        appearance: "",
        personality: "",
        definingTraits: [],
        background: "",
        arc: "",
        mentionOrdinals: [1],
        relationships: [],
      },
    ]);
  });

  it("sorts and dedupes mention ordinals, preserving the ascending contract", () => {
    expect(
      validateCharacterProfiles(
        [{ name: "Mara Vey", firstAppearanceOrdinal: 1, mentionOrdinals: [4, 1, 2, 1] }],
        MARA_CANON,
      ),
    ).toEqual([
      {
        ...MARA_PROFILE,
        appearance: "",
        personality: "",
        definingTraits: [],
        background: "",
        arc: "",
        mentionOrdinals: [1, 2, 4],
        relationships: [],
      },
    ]);
  });

  it("rejects a non-array payload and entries that are not objects", () => {
    expect(() => validateCharacterProfiles("not an array", CANON)).toThrow(
      /characterProfiles: must be an array of character profile entries/,
    );
    expect(() => validateCharacterProfiles(["Mara Vey"], CANON)).toThrow(
      /characterProfiles: entry #0 must be an object with a non-empty "name"/,
    );
    expect(() => validateCharacterProfiles([42], CANON)).toThrow(
      /entry #0 must be an object with a non-empty "name"/,
    );
  });

  it("rejects entries missing their name", () => {
    expect(() =>
      validateCharacterProfiles([{ appearance: "no name" }], CANON),
    ).toThrow(/characterProfiles: entry #0 "name" must be a non-empty string/);
  });

  it("rejects non-string defining-trait entries", () => {
    expect(() =>
      validateCharacterProfiles(
        [{ name: "Mara Vey", definingTraits: [42], firstAppearanceOrdinal: 1, mentionOrdinals: [1] }],
        CANON,
      ),
    ).toThrow(/"definingTraits" entries must be non-empty strings/);
  });
});

describe("validateCharacterProfiles — grounding (no unsourced entities)", () => {
  it("accepts profile names the canon establishes beyond the character list", () => {
    // A relationship endpoint is a canon-sourced name, so it may be profiled.
    const endpointOnly: SectionCanon = {
      facts: {
        ...emptyStoryFacts(),
        relationships: [{ from: "Mara Vey", to: "Bellin the harbormaster", relationType: "rival" }],
      },
      chapterSummaries: [{ ordinal: 1, summary: '"Bellin the harbormaster" appears.' }],
    };
    expect(
      validateCharacterProfiles(
        [
          {
            name: "Bellin the harbormaster",
            firstAppearanceOrdinal: 1,
            mentionOrdinals: [1],
            relationships: [],
          },
        ],
        endpointOnly,
      ),
    ).toHaveLength(1);
  });

  it("rejects a profile for a name the canon never establishes", () => {
    expect(() =>
      validateCharacterProfiles(
        [{ name: "Bellin the harbormaster", firstAppearanceOrdinal: 1, mentionOrdinals: [1] }],
        CANON,
      ),
    ).toThrow(/entry #0 introduces unsourced character "Bellin the harbormaster"/);
  });

  it("rejects relationship partners the canon never establishes", () => {
    expect(() =>
      validateCharacterProfiles(
        [
          {
            name: "Mara Vey",
            firstAppearanceOrdinal: 1,
            mentionOrdinals: [1],
            relationships: [{ other: "Pell Wynn", summary: "A stranger in port." }],
          },
        ],
        CANON,
      ),
    ).toThrow(/introduces unsourced relationship partner "Pell Wynn"/);
  });

  it("accepts relationship partners grounded by any canon fact naming them", () => {
    const holderCanon: SectionCanon = {
      facts: {
        ...MINI_FACTS,
        items: [{ item: "brass compass", holder: "Bellin the harbormaster" }],
      },
      chapterSummaries: MINI_SUMMARIES,
    };
    expect(
      validateCharacterProfiles(
        [
          {
            name: "Mara Vey",
            firstAppearanceOrdinal: 1,
            mentionOrdinals: [1],
            relationships: [{ other: "Bellin the harbormaster", summary: "Holds her compass." }],
          },
        ],
        { ...holderCanon, facts: { ...holderCanon.facts, characters: [{ name: "Mara Vey" }] } },
      ),
    ).toHaveLength(1);
  });

  it("rejects an empty relationship summary", () => {
    expect(() =>
      validateCharacterProfiles(
        [
          {
            name: "Mara Vey",
            firstAppearanceOrdinal: 1,
            mentionOrdinals: [1],
            relationships: [{ other: "Joren Vey", summary: "" }],
          },
        ],
        CANON,
      ),
    ).toThrow(/"summary" must be a non-empty string/);
  });
});

describe("validateCharacterProfiles — ordinals and coverage", () => {
  it("rejects non-positive or out-of-range first-appearance ordinals", () => {
    expect(() =>
      validateCharacterProfiles(
        [{ name: "Mara Vey", firstAppearanceOrdinal: 0, mentionOrdinals: [1] }],
        CANON,
      ),
    ).toThrow(/"firstAppearanceOrdinal" must be a positive integer/);
    expect(() =>
      validateCharacterProfiles(
        [{ name: "Mara Vey", firstAppearanceOrdinal: 5, mentionOrdinals: [4] }],
        CANON,
      ),
    ).toThrow(/"firstAppearanceOrdinal" must be a chapter ordinal within 1\.\.4/);
  });

  it("rejects mention ordinals outside the synthesized range", () => {
    expect(() =>
      validateCharacterProfiles(
        [{ name: "Mara Vey", firstAppearanceOrdinal: 1, mentionOrdinals: [1, 9] }],
        CANON,
      ),
    ).toThrow(/"mentionOrdinals" entries must be chapter ordinals within 1\.\.4/);
    expect(() =>
      validateCharacterProfiles(
        [{ name: "Mara Vey", firstAppearanceOrdinal: 1, mentionOrdinals: "1,2" }],
        CANON,
      ),
    ).toThrow(/"mentionOrdinals" must be an array of chapter ordinals/);
  });

  it("rejects empty mention lists and lists missing the first appearance", () => {
    expect(() =>
      validateCharacterProfiles(
        [{ name: "Mara Vey", firstAppearanceOrdinal: 1, mentionOrdinals: [] }],
        CANON,
      ),
    ).toThrow(/"mentionOrdinals" must not be empty for an established character/);
    expect(() =>
      validateCharacterProfiles(
        [{ name: "Mara Vey", firstAppearanceOrdinal: 2, mentionOrdinals: [1, 4] }],
        CANON,
      ),
    ).toThrow(/"mentionOrdinals" must include firstAppearanceOrdinal/);
  });

  it("rejects a payload missing an established character's profile", () => {
    const jorenless = [{ ...MARA_PROFILE }];
    expect(() => validateCharacterProfiles(jorenless, CANON)).toThrow(
      /missing profile for established character "Joren Vey"/,
    );
  });

  it("rejects duplicate profiles for the same character", () => {
    expect(() =>
      validateCharacterProfiles([MARA_PROFILE, { ...MARA_PROFILE, name: "Mara Vey" }], CANON),
    ).toThrow(/duplicate profile for "Mara Vey"/);
  });

  it("attaches a truncated near: snippet to every rejection", () => {
    try {
      validateCharacterProfiles([{ name: "x".repeat(400) }], CANON);
      expect.unreachable("expected a rejection");
    } catch (error) {
      const snippetText = nearSnippet(error);
      expect(snippetText).toContain('{"name":"xxx');
      expect(snippetText.length).toBeLessThanOrEqual(160);
    }
  });
});

describe("validateCharacterProfiles — empty canon", () => {
  it("accepts the empty section when canon establishes no characters", () => {
    expect(validateCharacterProfiles([], EMPTY_CANON)).toEqual([]);
  });

  it("rejects any profile when canon establishes no characters", () => {
    expect(() =>
      validateCharacterProfiles([MARA_PROFILE], EMPTY_CANON),
    ).toThrow(/introduces unsourced character "Mara Vey"/);
  });
});

describe("fakeCharacterProfiles — deterministic generation", () => {
  it("is deterministic across runs", () => {
    expect(fakeCharacterProfiles(CANON)).toEqual(fakeCharacterProfiles(CANON));
  });

  it("produces output its own validator accepts (fakes obey the same contract)", () => {
    expect(validateCharacterProfiles(fakeCharacterProfiles(CANON), CANON)).toEqual(
      fakeCharacterProfiles(CANON),
    );
  });

  it("profiles every established character in canon order with grounded aspects", () => {
    const [mara, joren] = fakeCharacterProfiles(CANON);
    expect(mara).toEqual({
      name: "Mara Vey",
      appearance: "her coat: salt-white wool.",
      personality: "",
      definingTraits: ["her coat"],
      background: "",
      arc: "",
      firstAppearanceOrdinal: 1,
      mentionOrdinals: [1, 2, 4],
      relationships: [
        { other: "Joren Vey", summary: "Mara Vey is the daughter of Joren Vey." },
        { other: "Joren Vey", summary: "Joren Vey is the father of Mara Vey." },
      ],
    });
    expect(joren).toEqual({
      name: "Joren Vey",
      appearance: "",
      personality: "",
      definingTraits: [],
      background: "",
      arc: "",
      firstAppearanceOrdinal: 1,
      mentionOrdinals: [1, 4],
      relationships: [
        { other: "Mara Vey", summary: "Mara Vey is the daughter of Joren Vey." },
        { other: "Mara Vey", summary: "Joren Vey is the father of Mara Vey." },
      ],
    });
  });

  it("grows per ordinal: an as-of-chapter-2 canon yields narrower mention lists", () => {
    const asOfTwo: SectionCanon = {
      facts: MINI_FACTS,
      chapterSummaries: MINI_SUMMARIES.slice(0, 2),
    };
    const profiles = fakeCharacterProfiles(asOfTwo);
    expect(profiles.map((p) => p.name)).toEqual(["Mara Vey", "Joren Vey"]);
    expect(profiles[0]?.mentionOrdinals).toEqual([1, 2]);
    expect(profiles[1]?.mentionOrdinals).toEqual([1]);
  });

  it("produces the empty section when canon establishes no characters", () => {
    expect(fakeCharacterProfiles(EMPTY_CANON)).toEqual([]);
  });
});
