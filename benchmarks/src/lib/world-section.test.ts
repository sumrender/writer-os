import { describe, expect, it } from "vitest";
import { emptyStoryFacts, type StoryFacts } from "./story-facts.js";
import { WORLD_CLASSIFICATIONS, WORLD_RULE_RELATIONS } from "./story-bible.js";
import type { BibleSynthesisInput } from "./pipeline.js";
import { WORLD_INSTRUCTION, WORLD_WIRE_SCHEMA, fakeWorld, validateWorld } from "./world-section.js";

/**
 * The World slice of the Story Bible (issue #16): classification,
 * description, and rules stated in relation to real-world (earth) rules.
 * The validator enforces shape at the trust boundary AND canon support —
 * non-earth classifications and deviating rules must trace to world-rule
 * facts; the fake derives the section deterministically from the synthesis
 * inputs, inventing nothing.
 */

const CANON_WITH_RULES: StoryFacts = {
  ...emptyStoryFacts(),
  worldRules: [{ topic: "the northern light burns without oil" }],
};

function inputWith(overrides: Partial<BibleSynthesisInput>): BibleSynthesisInput {
  return { chapters: [], facts: emptyStoryFacts(), summaries: [], ...overrides };
}

describe("validateWorld — shape", () => {
  it("accepts a well-formed section and preserves its fields", () => {
    const raw = {
      classification: "hybrid",
      description: "A harbor town with one impossible light.",
      rules: [
        {
          rule: "the northern light burns without oil",
          relation: "deviates_from_earth",
          note: "Real lamps need oil.",
        },
      ],
    };
    expect(validateWorld(raw, CANON_WITH_RULES)).toEqual(raw);
  });

  it("accepts the valid empty shape (nothing established)", () => {
    expect(
      validateWorld({ classification: "earth", description: "", rules: [] }, emptyStoryFacts()),
    ).toEqual({ classification: "earth", description: "", rules: [] });
  });

  it("normalizes a missing or null note to the empty string", () => {
    const rules = [{ rule: "omens are read", relation: "same_as_earth" }];
    expect(validateWorld({ classification: "earth", description: "d", rules }, emptyStoryFacts()))
      .toEqual({
        classification: "earth",
        description: "d",
        rules: [{ rule: "omens are read", relation: "same_as_earth", note: "" }],
      });
    expect(
      validateWorld(
        { classification: "earth", description: "d", rules: [{ ...rules[0], note: null }] },
        emptyStoryFacts(),
      ).rules[0]?.note,
    ).toBe("");
  });

  it("drops unknown fields on the section and its rule entries", () => {
    const validated = validateWorld(
      {
        classification: "earth",
        description: "d",
        rules: [{ rule: "r", relation: "same_as_earth", note: "", color: "red" }],
        pantheon: "invented",
      },
      emptyStoryFacts(),
    );
    expect("pantheon" in validated).toBe(false);
    expect(validated.rules[0]).toEqual({ rule: "r", relation: "same_as_earth", note: "" });
  });

  it("rejects non-object payloads and invalid classifications with near: snippets", () => {
    expect(() => validateWorld([{ topic: "x" }], emptyStoryFacts())).toThrow(
      /world: must be an object with \{classification, description, rules\} near:/,
    );
    expect(() =>
      validateWorld({ classification: "dreamlike", description: "", rules: [] }, emptyStoryFacts()),
    ).toThrow(
      new RegExp(`"classification" must be one of ${WORLD_CLASSIFICATIONS.join(", ")}`),
    );
  });

  it("rejects malformed rule entries", () => {
    expect(() =>
      validateWorld(
        { classification: "earth", description: "d", rules: ["bare mention"] },
        emptyStoryFacts(),
      ),
    ).toThrow(/rule #0 must be an object with \{rule, relation, note\}/);
    expect(() =>
      validateWorld(
        { classification: "earth", description: "d", rules: [{ relation: "same_as_earth" }] },
        emptyStoryFacts(),
      ),
    ).toThrow(/rule #0 "rule" must be a non-empty string/);
    expect(() =>
      validateWorld(
        { classification: "earth", description: "d", rules: [{ rule: "r", relation: "magic" }] },
        emptyStoryFacts(),
      ),
    ).toThrow(
      new RegExp(`"relation" must be one of ${WORLD_RULE_RELATIONS.join(", ")}`),
    );
  });
});

describe("validateWorld — canon support", () => {
  it("rejects a fantasy classification on a realist canon with no world rules", () => {
    expect(() =>
      validateWorld(
        { classification: "fantasy", description: "A wizarding realm.", rules: [] },
        emptyStoryFacts(),
      ),
    ).toThrow(/classification "fantasy" is unsupported/);
    expect(() =>
      validateWorld(
        { classification: "supernatural", description: "Ghosts are real.", rules: [] },
        emptyStoryFacts(),
      ),
    ).toThrow(/classification "supernatural" is unsupported/);
  });

  it("rejects a deviating rule that no canon world rule supports", () => {
    expect(() =>
      validateWorld(
        {
          classification: "hybrid",
          description: "d",
          rules: [
            { rule: "dragons can breathe fire", relation: "deviates_from_earth", note: "" },
          ],
        },
        CANON_WITH_RULES,
      ),
    ).toThrow(/rule "dragons can breathe fire" deviates from earth rules but no canon world rule supports it/);
  });

  it("accepts a deviating rule that quotes or wraps a canon world rule", () => {
    const rules = [
      {
        rule: "Canon is clear: the northern light burns without oil.",
        relation: "deviates_from_earth" as const,
        note: "",
      },
    ];
    expect(
      validateWorld({ classification: "hybrid", description: "d", rules }, CANON_WITH_RULES).rules,
    ).toEqual(rules);
  });

  it("rejects deviating rules under an earth classification (contradiction)", () => {
    expect(() =>
      validateWorld(
        {
          classification: "earth",
          description: "d",
          rules: [
            { rule: "the northern light burns without oil", relation: "deviates_from_earth", note: "" },
          ],
        },
        CANON_WITH_RULES,
      ),
    ).toThrow(/classification "earth" contradicts deviating rule/);
  });

  it("allows same-as-earth rules regardless of canon", () => {
    expect(
      validateWorld(
        {
          classification: "earth",
          description: "d",
          rules: [{ rule: "rivers flow downhill", relation: "same_as_earth", note: "" }],
        },
        emptyStoryFacts(),
      ).rules,
    ).toHaveLength(1);
  });
});

describe("fakeWorld", () => {
  it("derives an earth-classified baseline when canon establishes no world rules", () => {
    const world = fakeWorld(
      inputWith({
        facts: { ...emptyStoryFacts(), characters: [{ name: "Tom Sawyer" }] },
        summaries: [{ ordinal: 1, summary: "s" }],
      }),
    );
    expect(world.classification).toBe("earth");
    expect(world.description).not.toBe("");
    expect(world.rules).toEqual([
      {
        rule: "The story's world follows real-world (earth) rules.",
        relation: "same_as_earth",
        note: "Canon establishes no supernatural or invented system as of this point.",
      },
    ]);
  });

  it("derives a hybrid world with one deviating rule per canon world rule", () => {
    const world = fakeWorld(
      inputWith({
        facts: {
          ...CANON_WITH_RULES,
          characters: [{ name: "Mara Vey" }],
          locations: [{ name: "the northern light" }],
        },
        summaries: [
          { ordinal: 1, summary: "a" },
          { ordinal: 2, summary: "b" },
        ],
      }),
    );
    expect(world.classification).toBe("hybrid");
    expect(world.rules).toEqual([
      {
        rule: "the northern light burns without oil",
        relation: "deviates_from_earth",
        note: 'Canon establishes "the northern light burns without oil", which real-world (earth) rules do not allow.',
      },
    ]);
    expect(world.description).toContain("as of chapter 2");
    expect(world.description).toContain("the northern light");
  });

  it("derives a fantasy classification when deviations have no earth anchors", () => {
    const world = fakeWorld(inputWith({ facts: CANON_WITH_RULES }));
    expect(world.classification).toBe("fantasy");
  });

  it("is deterministic across runs", () => {
    const input = inputWith({ facts: CANON_WITH_RULES, summaries: [{ ordinal: 1, summary: "s" }] });
    expect(fakeWorld(input)).toEqual(fakeWorld(input));
  });

  it("emits sections its own validator accepts", () => {
    for (const facts of [emptyStoryFacts(), CANON_WITH_RULES]) {
      const world = fakeWorld(inputWith({ facts }));
      expect(() => validateWorld(world, facts)).not.toThrow();
    }
  });
});

describe("world section registration", () => {
  it("contributes a non-empty instruction block naming every classification", () => {
    expect(WORLD_INSTRUCTION).toContain("world:");
    for (const classification of WORLD_CLASSIFICATIONS) {
      expect(WORLD_INSTRUCTION).toContain(classification);
    }
  });

  it("declares the object wire shape with classification, description, and rules", () => {
    expect(WORLD_WIRE_SCHEMA.type).toBe("object");
    expect(WORLD_WIRE_SCHEMA.required).toEqual(["classification", "description", "rules"]);
  });
});
