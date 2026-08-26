import { describe, expect, it } from "vitest";
import { createStubJudge } from "./stub-judge.js";
import { gradeBeats } from "./beat-grade.js";
import type { BeatChapter } from "./beats.js";

const chapter = (overrides: Partial<BeatChapter> = {}): BeatChapter => ({
  ordinal: 4,
  mustInclude: [],
  mustNotInclude: [],
  ...overrides,
});

describe("gradeBeats", () => {
  it("detects a required beat present verbatim without consulting the judge", async () => {
    const judge = createStubJudge();
    const result = await gradeBeats(
      "The story turns on: the brass compass passes to Joren Vey.\nHere ends chapter 4.\n",
      chapter({ mustInclude: ["the brass compass passes to Joren Vey"] }),
      judge,
    );

    expect(result.missingBeats).toEqual([]);
    expect(judge.calls.equivalence).toBe(0);
  });

  it("resolves a paraphrased required beat through the equivalence judge", async () => {
    const judge = createStubJudge({
      equivalences: [
        {
          left: "the brass compass passes to Joren Vey",
          right: "Joren Vey now holds the old brass compass.",
          equivalent: true,
        },
      ],
    });
    const result = await gradeBeats(
      "Joren Vey now holds the old brass compass.\n",
      chapter({ mustInclude: ["the brass compass passes to Joren Vey"] }),
      judge,
    );

    expect(result.missingBeats).toEqual([]);
    expect(judge.calls.equivalence).toBeGreaterThan(0);
  });

  it("lists a required beat as missing when no candidate is judged equivalent", async () => {
    const judge = createStubJudge({ defaultEquivalent: false });
    const result = await gradeBeats(
      "Nothing at all happens here.\n",
      chapter({ mustInclude: ["the brass compass passes to Joren Vey"] }),
      judge,
    );

    expect(result.missingBeats).toEqual(["the brass compass passes to Joren Vey"]);
  });

  it("flags a forbidden beat that appears verbatim", async () => {
    const judge = createStubJudge();
    const result = await gradeBeats(
      "Mara Vey and Joren Vey are revealed as sisters.\n",
      chapter({ mustNotInclude: ["Mara Vey and Joren Vey are revealed as sisters"] }),
      judge,
    );

    expect(result.violatedBeats).toEqual(["Mara Vey and Joren Vey are revealed as sisters"]);
  });

  it("does not flag a forbidden beat that never appears", async () => {
    const judge = createStubJudge({ defaultEquivalent: false });
    const result = await gradeBeats(
      "The compass changes hands quietly.\n",
      chapter({ mustNotInclude: ["Mara Vey and Joren Vey are revealed as sisters"] }),
      judge,
    );

    expect(result.violatedBeats).toEqual([]);
  });

  it("grades must_include and must_not_include independently in one pass", async () => {
    const judge = createStubJudge();
    const result = await gradeBeats(
      "The story turns on: the ledger is resolved.\nHere ends chapter 4.\n",
      chapter({
        mustInclude: ["the ledger is resolved"],
        mustNotInclude: ["the northern light goes dark"],
      }),
      judge,
    );

    expect(result.missingBeats).toEqual([]);
    expect(result.violatedBeats).toEqual([]);
  });

  it("passes an empty chapter through with no findings and no judge calls needed for absent beats", async () => {
    const judge = createStubJudge();
    const result = await gradeBeats("Any old prose.\n", chapter(), judge);

    expect(result.missingBeats).toEqual([]);
    expect(result.violatedBeats).toEqual([]);
  });
});
