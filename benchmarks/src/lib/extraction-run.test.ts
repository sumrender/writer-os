import { describe, expect, it } from "vitest";
import { emptyStoryFacts, type StoryFacts } from "./story-facts.js";
import { factsBeforeOrdinal, runExtraction, snapshotsByOrdinal } from "./extraction-run.js";

const chapters = [
  { ordinal: 1, text: "one" },
  { ordinal: 2, text: "two" },
  { ordinal: 3, text: "three" },
];

describe("runExtraction", () => {
  it("feeds chapters sequentially in ordinal order, threading state through", async () => {
    const calls: { ordinal: number; text: string; carried: number }[] = [];
    const snapshots = await runExtraction(chapters, async (text, ordinal, factsSoFar) => {
      calls.push({
        ordinal,
        text,
        carried: factsSoFar.characters.length,
      });
      return {
        ...factsSoFar,
        characters: [...factsSoFar.characters, { name: `c${ordinal}` }],
      };
    });

    expect(calls.map((c) => c.ordinal)).toEqual([1, 2, 3]);
    expect(calls.map((c) => c.text)).toEqual(["one", "two", "three"]);
    expect(calls.map((c) => c.carried)).toEqual([0, 1, 2]);
  });

  it("returns one snapshot per chapter with the facts state after that ordinal", async () => {
    const snapshots = await runExtraction(chapters, async (_text, ordinal, soFar) => ({
      ...soFar,
      characters: [...soFar.characters, { name: `c${ordinal}` }],
    }));

    expect(snapshots.map((s) => s.afterOrdinal)).toEqual([1, 2, 3]);
    const last: StoryFacts | undefined = snapshots[2]?.facts;
    expect(last?.characters.map((c) => c.name)).toEqual(["c1", "c2", "c3"]);
  });

  it("starts from empty facts and yields nothing for an empty book", async () => {
    let invoked = false;
    const snapshots = await runExtraction([], async () => {
      invoked = true;
      return emptyStoryFacts();
    });

    expect(invoked).toBe(false);
    expect(snapshots).toEqual([]);
  });
});

describe("factsBeforeOrdinal", () => {
  it("returns the empty facts store for ordinal 1 regardless of the snapshot map", () => {
    const canon = factsBeforeOrdinal(1, new Map());
    expect(canon).toEqual(emptyStoryFacts());
  });

  it("returns the snapshot after the prior ordinal", () => {
    const priorFacts: StoryFacts = { ...emptyStoryFacts(), characters: [{ name: "Mara Vey" }] };
    const canon = factsBeforeOrdinal(3, new Map([[2, priorFacts]]));
    expect(canon).toBe(priorFacts);
  });

  it("throws precisely when the prior snapshot is missing", () => {
    expect(() => factsBeforeOrdinal(5, new Map())).toThrow(/no extraction snapshot for chapter 4/i);
  });
});

describe("snapshotsByOrdinal", () => {
  it("indexes each snapshot's facts by its after-ordinal", async () => {
    const snapshots = await runExtraction(chapters, async (_text, ordinal, soFar) => ({
      ...soFar,
      characters: [...soFar.characters, { name: `c${ordinal}` }],
    }));

    const byOrdinal = snapshotsByOrdinal(snapshots);
    expect(byOrdinal.get(2)?.characters.map((c) => c.name)).toEqual(["c1", "c2"]);
  });

  it("yields an empty map for an empty book", () => {
    expect(snapshotsByOrdinal([]).size).toBe(0);
  });
});
