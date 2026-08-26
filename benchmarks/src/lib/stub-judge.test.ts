import { describe, expect, it } from "vitest";
import { createStubJudge } from "./stub-judge.js";

describe("createStubJudge", () => {
  it("answers scripted equivalence pairs exactly as scripted", async () => {
    const judge = createStubJudge({
      equivalences: [
        { left: "daughter", right: "child of", equivalent: true },
        { left: "daughter", right: "sister", equivalent: false },
      ],
      defaultEquivalent: true,
    });

    expect(await judge.areEquivalent({ left: "daughter", right: "child of" })).toBe(true);
    expect(await judge.areEquivalent({ left: "daughter", right: "sister" })).toBe(false);
  });

  it("falls back to the default verdict when no case matches", async () => {
    const judge = createStubJudge({
      equivalences: [{ left: "a", right: "b", equivalent: true }],
      defaultEquivalent: false,
    });

    expect(await judge.areEquivalent({ left: "x", right: "y" })).toBe(false);
    expect(await judge.areEquivalent({ left: "a", right: "b" })).toBe(true);
  });

  it("treats an unscripted judge as rejecting everything by default", async () => {
    const judge = createStubJudge();
    expect(await judge.areEquivalent({ left: "same", right: "same" })).toBe(false);
    expect(await judge.isSupportedBySource({ fact: "anything", sourceText: "text" })).toBe(false);
  });

  it("matches support probes by substring of the rendered fact", async () => {
    const judge = createStubJudge({
      support: [
        { factIncludes: "iron ships", supported: true },
        { factIncludes: "compass", supported: false },
      ],
      defaultSupported: true,
    });

    expect(
      await judge.isSupportedBySource({ fact: 'world_rule: "vessels of iron"', sourceText: "s" }),
    ).toBe(true);
    expect(
      await judge.isSupportedBySource({ fact: 'item: compass held by Mara', sourceText: "s" }),
    ).toBe(false);
    expect(await judge.isSupportedBySource({ fact: "unrelated", sourceText: "s" })).toBe(true);
  });

  it("counts calls so tests can prove caching happened above it", async () => {
    const judge = createStubJudge({
      equivalences: [{ left: "a", right: "b", equivalent: true }],
    });
    await judge.areEquivalent({ left: "a", right: "b" });
    await judge.areEquivalent({ left: "a", right: "b" });
    await judge.isSupportedBySource({ fact: "f", sourceText: "s" });

    expect(judge.calls).toEqual({ equivalence: 2, support: 1 });
  });
});
