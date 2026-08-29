import { describe, expect, it } from "vitest";
import { emptyStoryFacts } from "./story-facts.js";
import { createStubJudge } from "./stub-judge.js";
import { storyFacts, entryKey } from "./fact-text.js";
import { bookSourceText, sweepUnmatchedFacts } from "./sweep.js";

describe("bookSourceText", () => {
  it("labels each chapter with its ordinal in order", () => {
    const text = bookSourceText([
      { ordinal: 1, text: "first" },
      { ordinal: 2, text: "second" },
    ]);
    expect(text).toBe("[chapter 1]\nfirst\n\n[chapter 2]\nsecond");
  });
});

describe("sweepUnmatchedFacts", () => {
  it("judges only facts no positive assertion claimed", async () => {
    const state = {
      ...emptyStoryFacts(),
      characters: [{ name: "Mara Vey" }],
      items: [{ item: "brass compass", holder: "Joren Vey" }],
    };
    const claimed = new Set(
      storyFacts(state)
        .filter((f) => f.entityKind === "character")
        .map((f) => f.key),
    );
    const judge = createStubJudge({ defaultSupported: true });

    const result = await sweepUnmatchedFacts(state, claimed, "[chapter 1]\n...", judge);

    expect(result.swept).toBe(1);
    expect(result.findings[0]?.fact.entityKind).toBe("item");
    expect(judge.calls.support).toBe(1);
  });

  it("computes the estimated fabrication rate from unsupported findings", async () => {
    const state = {
      ...emptyStoryFacts(),
      worldRules: [{ topic: "vessels of iron" }],
      timeline: ["the ledger burned"],
    };
    const judge = createStubJudge({
      support: [{ factIncludes: "iron", supported: false }],
      defaultSupported: true,
    });

    const result = await sweepUnmatchedFacts(state, new Set(), "source", judge);

    expect(result.swept).toBe(2);
    expect(result.unsupported).toBe(1);
    expect(result.rate).toBeCloseTo(0.5);
    expect(result.findings.map((f) => f.supported)).toEqual([false, true]);
  });

  it("reports a zero rate without calling the judge when everything is claimed", async () => {
    const state = { ...emptyStoryFacts(), characters: [{ name: "Joren Vey" }] };
    const allClaimed = new Set(storyFacts(state).map((f) => f.key));
    const judge = createStubJudge({ defaultSupported: false });

    const result = await sweepUnmatchedFacts(state, allClaimed, "source", judge);

    expect(result.swept).toBe(0);
    expect(result.unsupported).toBe(0);
    expect(result.rate).toBe(0);
    expect(judge.calls.support).toBe(0);
  });

  it("hands the judge a rendered fact plus the labeled source text", async () => {
    const state = { ...emptyStoryFacts(), items: [{ item: "brass compass", holder: "Mara Vey" }] };
    let seen: { fact: string; sourceText: string } | undefined;
    const spy = {
      async isSupportedBySource(request: { fact: string; sourceText: string }) {
        seen = request;
        return true;
      },
    };

    await sweepUnmatchedFacts(state, new Set(), "[chapter 2]\nThe brass compass rests.", spy);

    expect(seen?.fact).toContain("brass compass");
    expect(seen?.sourceText).toContain("[chapter 2]");
  });

  it("keys findings by content so callers can cross-reference claims", async () => {
    const state = { ...emptyStoryFacts(), items: [{ item: "brass compass", holder: "Mara Vey" }] };
    const result = await sweepUnmatchedFacts(state, new Set(), "s", createStubJudge());
    expect(result.findings[0]?.fact.key).toBe(entryKey("item", state.items[0]));
  });
});
