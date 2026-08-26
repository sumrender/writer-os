import { describe, expect, it } from "vitest";
import { emptyBible } from "./bible.js";
import { fakeExtract } from "./fakes.js";
import { runExtraction } from "./extraction-run.js";
import { runCheckerCases } from "./checker-run.js";
import type { Check } from "./pipeline.js";
import type { PerturbationCase } from "./perturbation-file.js";

const CHAPTERS = [
  { ordinal: 1, text: "The brass compass rests with Mara Vey." },
  { ordinal: 2, text: "The brass compass rests with Mara Vey." },
];

function perturbationCase(baseOrdinal: number, chapterText: string): PerturbationCase {
  return {
    entry: {
      kind: "perturbation",
      id: `case-${baseOrdinal}`,
      baseOrdinal,
      file: "perturbations/x.txt",
      edits: [{ description: "swap" }],
      violates: ["some-id"],
      expect: "flag",
    },
    chapterText,
  };
}

function controlCase(baseOrdinal: number, chapterText: string): PerturbationCase {
  return {
    entry: { kind: "control", id: `control-${baseOrdinal}`, baseOrdinal, expect: "no_flags" },
    chapterText,
  };
}

describe("runCheckerCases", () => {
  it("checks base_ordinal 1 against an empty canon (nothing yet established)", async () => {
    const results = await runCheckerCases(
      [controlCase(1, "The brass compass rests with Bellin the harbormaster.")],
      [],
      async (canon, text) => {
        expect(canon).toEqual(emptyBible());
        return { flags: [] };
      },
    );
    expect(results).toEqual([{ caseId: "control-1", raised: false }]);
  });

  it("checks base_ordinal N against the snapshot after chapter N-1", async () => {
    const snapshots = await runExtraction(CHAPTERS, fakeExtract);
    const flaggingCheck: Check = async (canon, text) => {
      const established = canon.items.find((i) => i.item === "brass compass");
      expect(established).toEqual({ item: "brass compass", holder: "Mara Vey" });
      return text.includes("Bellin") ? { flags: [{ kind: "item", message: "holder mismatch" }] } : { flags: [] };
    };

    const results = await runCheckerCases(
      [perturbationCase(2, "The brass compass rests with Bellin the harbormaster.")],
      snapshots,
      flaggingCheck,
    );

    expect(results).toEqual([{ caseId: "case-2", raised: true }]);
  });

  it("throws precisely when a required snapshot is missing", async () => {
    await expect(
      runCheckerCases([perturbationCase(5, "text")], [], async () => ({ flags: [] })),
    ).rejects.toThrow(/no extraction snapshot for chapter 4/i);
  });

  it("reports raised: false when the checker returns no flags", async () => {
    const results = await runCheckerCases(
      [controlCase(1, "Introducing Pell Wynn, a stranger.")],
      [],
      async () => ({ flags: [] }),
    );
    expect(results[0]?.raised).toBe(false);
  });
});
