import { describe, expect, it } from "vitest";
import { emptyBible, type BibleState } from "./bible.js";
import { runExtraction } from "./extraction-run.js";

const chapters = [
  { ordinal: 1, text: "one" },
  { ordinal: 2, text: "two" },
  { ordinal: 3, text: "three" },
];

describe("runExtraction", () => {
  it("feeds chapters sequentially in ordinal order, threading state through", async () => {
    const calls: { ordinal: number; text: string; carried: number }[] = [];
    const snapshots = await runExtraction(chapters, async (text, ordinal, bibleSoFar) => {
      calls.push({
        ordinal,
        text,
        carried: bibleSoFar.characters.length,
      });
      return {
        ...bibleSoFar,
        characters: [...bibleSoFar.characters, { name: `c${ordinal}` }],
      };
    });

    expect(calls.map((c) => c.ordinal)).toEqual([1, 2, 3]);
    expect(calls.map((c) => c.text)).toEqual(["one", "two", "three"]);
    expect(calls.map((c) => c.carried)).toEqual([0, 1, 2]);
  });

  it("returns one snapshot per chapter with the bible state after that ordinal", async () => {
    const snapshots = await runExtraction(chapters, async (_text, ordinal, soFar) => ({
      ...soFar,
      characters: [...soFar.characters, { name: `c${ordinal}` }],
    }));

    expect(snapshots.map((s) => s.afterOrdinal)).toEqual([1, 2, 3]);
    const last: BibleState | undefined = snapshots[2]?.bible;
    expect(last?.characters.map((c) => c.name)).toEqual(["c1", "c2", "c3"]);
  });

  it("starts from an empty bible and yields nothing for an empty book", async () => {
    let invoked = false;
    const snapshots = await runExtraction([], async () => {
      invoked = true;
      return emptyBible();
    });

    expect(invoked).toBe(false);
    expect(snapshots).toEqual([]);
  });
});
