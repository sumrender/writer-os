import { describe, expect, it } from "vitest";
import { BIBLE_SECTIONS } from "./bible-sections.js";
import {
  validateLocationsGrounded,
  type SectionGrounding,
} from "./grounded-locations.js";
import { emptyStoryFacts } from "./story-facts.js";

/**
 * The locations section validator (issue #17): the registry validator
 * (`BIBLE_SECTIONS.locations.validate`) is the pure-shape trust boundary;
 * `validateLocationsGrounded` adds rejection of entries that are
 * well-formed but unsupported by the canon (invented places, invented
 * characters, fabricated co-occurrence ordinals, omitted characters).
 */

/** The registry validator seen through a bare canon — locations ignores it. */
const validateShape = (raw: unknown) =>
  BIBLE_SECTIONS.locations.validate(raw, { facts: emptyStoryFacts(), chapterSummaries: [] });

const VALID_ENTRY = {
  name: "the northern light",
  description: "A lighthouse on the headland.",
  significance: "Anchors the keeper's daily round.",
  charactersSeen: [{ character: "Mara Vey", firstCoOccurrenceOrdinal: 1 }],
};

const GROUNDING: SectionGrounding = {
  knownLocationNames: new Set(["the northern light"]),
  knownCharacterNames: new Set(["Mara Vey", "Joren Vey"]),
  coOccurrenceByLocation: new Map([
    ["the northern light", [{ character: "Mara Vey", firstCoOccurrenceOrdinal: 1 }]],
  ]),
};

describe("locations validator — shape", () => {
  it("rejects a non-array payload", () => {
    expect(() => validateShape("not an array")).toThrow(
      /locations: must be an array of \{name, description, significance, charactersSeen\} entries/,
    );
  });

  it("rejects an entry that is not an object", () => {
    expect(() => validateShape(["a string"])).toThrow(
      /entry #0 must be an object with a non-empty "name"/,
    );
  });

  it("rejects an entry with a missing name", () => {
    expect(() =>
      validateShape([
        { description: "d", significance: "s", charactersSeen: [] },
      ]),
    ).toThrow(/entry #0 "name" must be a non-empty string/);
  });

  it("rejects an entry with an empty name", () => {
    expect(() =>
      validateShape([
        { name: "", description: "d", significance: "s", charactersSeen: [] },
      ]),
    ).toThrow(/entry #0 "name" must be a non-empty string/);
  });

  it("rejects an entry with a missing description", () => {
    expect(() =>
      validateShape([
        { name: "x", significance: "s", charactersSeen: [] },
      ]),
    ).toThrow(/entry #0 "description" must be a non-empty string/);
  });

  it("rejects an entry with an empty description", () => {
    expect(() =>
      validateShape([
        { name: "x", description: "", significance: "s", charactersSeen: [] },
      ]),
    ).toThrow(/entry #0 "description" must be a non-empty string/);
  });

  it("rejects an entry with a missing significance", () => {
    expect(() =>
      validateShape([
        { name: "x", description: "d", charactersSeen: [] },
      ]),
    ).toThrow(/entry #0 "significance" must be a non-empty string/);
  });

  it("rejects an entry whose charactersSeen is not an array", () => {
    expect(() =>
      validateShape([
        { name: "x", description: "d", significance: "s", charactersSeen: "junk" },
      ]),
    ).toThrow(/entry #0 "charactersSeen" must be an array/);
  });

  it("rejects a charactersSeen entry that is not an object", () => {
    expect(() =>
      validateShape([
        {
          name: "x",
          description: "d",
          significance: "s",
          charactersSeen: ["bare string"],
        },
      ]),
    ).toThrow(/"charactersSeen" #0 must be an object/);
  });

  it("rejects a charactersSeen entry with a non-string character", () => {
    expect(() =>
      validateShape([
        {
          name: "x",
          description: "d",
          significance: "s",
          charactersSeen: [{ character: 42, firstCoOccurrenceOrdinal: 1 }],
        },
      ]),
    ).toThrow(/"charactersSeen" #0 "character" must be a non-empty string/);
  });

  it("rejects a charactersSeen entry with a non-positive integer ordinal", () => {
    expect(() =>
      validateShape([
        {
          name: "x",
          description: "d",
          significance: "s",
          charactersSeen: [{ character: "Mara", firstCoOccurrenceOrdinal: 0 }],
        },
      ]),
    ).toThrow(/"firstCoOccurrenceOrdinal" must be a positive integer/);
    expect(() =>
      validateShape([
        {
          name: "x",
          description: "d",
          significance: "s",
          charactersSeen: [{ character: "Mara", firstCoOccurrenceOrdinal: -3 }],
        },
      ]),
    ).toThrow(/"firstCoOccurrenceOrdinal" must be a positive integer/);
    expect(() =>
      validateShape([
        {
          name: "x",
          description: "d",
          significance: "s",
          charactersSeen: [{ character: "Mara", firstCoOccurrenceOrdinal: 1.5 }],
        },
      ]),
    ).toThrow(/"firstCoOccurrenceOrdinal" must be a positive integer/);
  });

  it("accepts a well-formed entry with empty charactersSeen", () => {
    const result = validateShape([
      { name: "x", description: "d", significance: "s", charactersSeen: [] },
    ]);
    expect(result).toEqual([
      { name: "x", description: "d", significance: "s", charactersSeen: [] },
    ]);
  });

  it("accepts the trust-boundary case, even with unknown names", () => {
    const result = validateShape([VALID_ENTRY]);
    expect(result).toEqual([VALID_ENTRY]);
  });
});

describe("locations validator — grounding", () => {
  it("rejects an invented place not in the location facts", () => {
    expect(() =>
      validateLocationsGrounded(
        [
          {
            name: "an invented cave",
            description: "d",
            significance: "s",
            charactersSeen: [],
          },
        ],
        GROUNDING,
      ),
    ).toThrow(
      /"name" "an invented cave" is not in canon — invented places are rejected/,
    );
  });

  it("rejects a charactersSeen entry citing an invented character", () => {
    expect(() =>
      validateLocationsGrounded(
        [
          {
            name: "the northern light",
            description: "d",
            significance: "s",
            charactersSeen: [
              { character: "An Outsider", firstCoOccurrenceOrdinal: 1 },
            ],
          },
        ],
        GROUNDING,
      ),
    ).toThrow(/"charactersSeen" includes "An Outsider" — not a canon character/);
  });

  it("rejects a character declared at a location who never co-occurs there", () => {
    const emptyGrounding: SectionGrounding = {
      knownLocationNames: new Set(["the northern light"]),
      knownCharacterNames: new Set(["Mara Vey", "Joren Vey"]),
      coOccurrenceByLocation: new Map([["the northern light", []]]),
    };
    expect(() =>
      validateLocationsGrounded(
        [
          {
            name: "the northern light",
            description: "d",
            significance: "s",
            charactersSeen: [
              { character: "Joren Vey", firstCoOccurrenceOrdinal: 2 },
            ],
          },
        ],
        emptyGrounding,
      ),
    ).toThrow(/"Joren Vey" never appears at "the northern light"/);
  });

  it("rejects a mismatched firstCoOccurrenceOrdinal", () => {
    expect(() =>
      validateLocationsGrounded(
        [
          {
            name: "the northern light",
            description: "d",
            significance: "s",
            charactersSeen: [
              { character: "Mara Vey", firstCoOccurrenceOrdinal: 99 },
            ],
          },
        ],
        GROUNDING,
      ),
    ).toThrow(/Mara Vey" first co-occurs at chapter 1 in the chapter texts but the entry says 99/);
  });

  it("rejects an entry that omits a character the derivation says co-occurs", () => {
    expect(() =>
      validateLocationsGrounded(
        [
          {
            name: "the northern light",
            description: "d",
            significance: "s",
            charactersSeen: [],
          },
        ],
        GROUNDING,
      ),
    ).toThrow(/omits "Mara Vey" who co-occurs at "the northern light"/);
  });

  it("rejects an entry whose name is in canon but absent from the co-occurrence derivation", () => {
    const derivationMissing: SectionGrounding = {
      knownLocationNames: new Set(["the northern light"]),
      knownCharacterNames: new Set(["Mara Vey"]),
      coOccurrenceByLocation: new Map(),
    };
    expect(() => validateLocationsGrounded([VALID_ENTRY], derivationMissing)).toThrow(
      /has no co-occurrence derivation/,
    );
  });

  it("accepts an empty locations array under grounding", () => {
    expect(validateLocationsGrounded([], GROUNDING)).toEqual([]);
  });

  it("accepts a grounded entry that matches the derivation exactly", () => {
    expect(validateLocationsGrounded([VALID_ENTRY], GROUNDING)).toEqual([VALID_ENTRY]);
  });
});
