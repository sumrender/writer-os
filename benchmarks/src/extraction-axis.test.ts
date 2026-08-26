import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAssertionSet } from "./lib/assertion-file.js";
import { validateBook } from "./lib/manifest.js";
import { fakeExtract } from "./lib/fakes.js";
import type { Extract } from "./lib/pipeline.js";
import { createStubJudge } from "./lib/stub-judge.js";
import { CachingJudge } from "./lib/cached-judge.js";
import { MemoryVerdictCache } from "./lib/verdict-cache.js";
import { DEFAULT_GATES } from "./lib/gates.js";
import { runExtractionAxis } from "./extraction-axis.js";
import { formatJsonReport, formatTextReport } from "./report.js";

const booksRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "books");

async function loadMiniBook() {
  const book = validateBook(join(booksRoot, "mini-book"));
  if (!book.ok) throw new Error("mini-book fixture must validate");
  const assertions = loadAssertionSet(join(booksRoot, "mini-book"), { maxOrdinal: 4 });
  if (!assertions.ok) throw new Error("mini-book assertions must validate");
  return { chapters: book.chapters, set: assertions.set };
}

describe("runExtractionAxis — known-by-construction scores", () => {
  it("scores the mini-book perfectly across three offline runs", async () => {
    const { chapters, set } = await loadMiniBook();

    const report = await runExtractionAxis({
      bookId: "mini-book",
      chapters,
      assertions: set,
      extract: fakeExtract,
      judge: createStubJudge({ defaultSupported: true }),
      gates: DEFAULT_GATES,
    });

    expect(report.passed).toBe(true);
    expect(report.runs).toBe(3);
    expect(report.kinds).toHaveLength(9);
    for (const entry of report.kinds) {
      const { precision, recall, f1 } = entry.report;
      expect(precision.mean, `${entry.kind} precision`).toBe(1);
      expect(recall.mean, `${entry.kind} recall`).toBe(1);
      expect(f1.mean, `${entry.kind} f1`).toBe(1);
      expect(precision.variance).toBe(0);
      expect(recall.variance).toBe(0);
      expect(f1.variance).toBe(0);
    }
    expect(report.globalPrecision.mean).toBe(1);
    expect(report.globalPrecision.variance).toBe(0);
    expect(report.sweep.estimatedFabricationRate.mean).toBe(0);
    expect(report.sweep.swept.mean).toBeCloseTo(1);
    expect(report.gates.passed).toBe(true);
  });

  it("counts the unasserted father relationship as the only swept fact", async () => {
    const { chapters, set } = await loadMiniBook();

    const report = await runExtractionAxis({
      bookId: "mini-book",
      chapters,
      assertions: set,
      extract: fakeExtract,
      judge: createStubJudge({ defaultSupported: true }),
      gates: DEFAULT_GATES,
    });

    expect(report.sweep.unsupported.mean).toBe(0);
    expect(report.sweep.estimatedFabricationRate.variance).toBe(0);
  });
});

describe("runExtractionAxis — judge-routed paraphrases with caching", () => {
  it("resolves a paraphrased relation type through the cached judge exactly once", async () => {
    const { chapters, set } = await loadMiniBook();
    const paraphrasingExtract: Extract = async (text, ordinal, bibleSoFar) => {
      const state = await fakeExtract(text, ordinal, bibleSoFar);
      return {
        ...state,
        relationships: state.relationships.map((r) =>
          r.relationType === "daughter" ? { ...r, relationType: "child of" } : r,
        ),
      };
    };
    const stub = createStubJudge({
      equivalences: [{ left: "daughter", right: "child of", equivalent: true }],
    });
    const judge = new CachingJudge(stub, new MemoryVerdictCache());

    const report = await runExtractionAxis({
      bookId: "mini-book",
      chapters,
      assertions: set,
      extract: paraphrasingExtract,
      judge,
      gates: DEFAULT_GATES,
    });

    const relationship = report.kinds.find((k) => k.kind === "relationship");
    expect(relationship?.report.f1.mean).toBe(1);
    expect(stub.calls.equivalence).toBe(1);
  });
});

describe("runExtractionAxis — omissions, fabrications, gates", () => {
  const withoutLexiconCh2: Extract = async (text, ordinal, bible) =>
    fakeExtract(
      text
        .split("\n")
        .filter((line) => !line.startsWith('Say always "Vess"'))
        .join("\n"),
      ordinal,
      bible,
    );

  it("fails recall-driven gates when a required term is omitted every run", async () => {
    const { chapters, set } = await loadMiniBook();

    const report = await runExtractionAxis({
      bookId: "mini-book",
      chapters,
      assertions: set,
      extract: withoutLexiconCh2,
      judge: createStubJudge(),
      gates: { ...DEFAULT_GATES, recallMin: { lexicon: 0.9 } },
    });

    const lexicon = report.kinds.find((k) => k.kind === "lexicon");
    expect(lexicon?.report.recall.mean).toBe(0);
    expect(report.gates.passed).toBe(false);
    expect(report.gates.checks.some((c) => !c.passed && c.gate === "recall.lexicon")).toBe(true);
    expect(report.passed).toBe(false);
  });

  it("reports judge-estimated fabrications separately without touching exact scores", async () => {
    const { chapters, set } = await loadMiniBook();
    const FABRICATED_RULE = "vessels of iron ships";
    const fabricatingExtract: Extract = async (text, ordinal, bible) => {
      const state = await fakeExtract(text, ordinal, bible);
      return state.worldRules.some((r) => r.topic === FABRICATED_RULE)
        ? state
        : { ...state, worldRules: [...state.worldRules, { topic: FABRICATED_RULE }] };
    };

    const report = await runExtractionAxis({
      bookId: "mini-book",
      chapters,
      assertions: set,
      extract: fabricatingExtract,
      judge: createStubJudge({
        support: [{ factIncludes: "iron", supported: false }],
        defaultSupported: true,
      }),
      gates: { ...DEFAULT_GATES, globalPrecisionMin: 1 },
    });

    expect(report.globalPrecision.mean).toBe(1);
    expect(report.sweep.estimatedFabricationRate.mean).toBeGreaterThan(0);
    expect(report.sweep.unsupported.mean).toBe(1);
    expect(report.gates.checks.find((c) => c.gate === "global_precision")?.passed).toBe(true);
    expect(report.passed).toBe(true);
  });
});

describe("runExtractionAxis — protocol guards", () => {
  it("rejects a non-positive run count up front", async () => {
    const { chapters, set } = await loadMiniBook();
    await expect(
      runExtractionAxis({
        bookId: "mini-book",
        chapters,
        assertions: set,
        extract: fakeExtract,
        judge: createStubJudge(),
        gates: DEFAULT_GATES,
        runs: 0,
      }),
    ).rejects.toThrow(/at least one run/i);
  });

  it("honors a custom run count", async () => {
    const { chapters, set } = await loadMiniBook();
    const report = await runExtractionAxis({
      bookId: "mini-book",
      chapters,
      assertions: set,
      extract: fakeExtract,
      judge: createStubJudge(),
      gates: DEFAULT_GATES,
      runs: 1,
    });
    expect(report.runs).toBe(1);
  });
});

describe("report formatting", () => {
  it("renders per-kind rows, sweep estimate, and gate status as text", async () => {
    const { chapters, set } = await loadMiniBook();
    const report = await runExtractionAxis({
      bookId: "mini-book",
      chapters,
      assertions: set,
      extract: fakeExtract,
      judge: createStubJudge({ defaultSupported: true }),
      gates: DEFAULT_GATES,
    });

    const text = formatTextReport(report).join("\n");

    expect(text).toContain("extraction — mini-book");
    expect(text).toContain("runs: 3");
    expect(text).toContain("character");
    expect(text).toContain("precision 1.000");
    expect(text).toContain("estimated fabrication rate");
    expect(text).toContain("gates: PASS");
  });

  it("lists failing gates explicitly when the run fails", async () => {
    const { chapters, set } = await loadMiniBook();
    const withoutStyle: Extract = async (text, ordinal, bible) =>
      fakeExtract(
        text
          .split("\n")
          .filter((line) => !line.startsWith("Style decree"))
          .join("\n"),
        ordinal,
        bible,
      );
    const report = await runExtractionAxis({
      bookId: "mini-book",
      chapters,
      assertions: set,
      extract: withoutStyle,
      judge: createStubJudge(),
      gates: { ...DEFAULT_GATES, recallMin: { style: 1.0 } },
    });

    const text = formatTextReport(report).join("\n");

    expect(report.passed).toBe(false);
    expect(text).toContain("gates: FAIL");
    expect(text).toContain("recall.style");
    expect(text).toContain("< floor 1.000");
  });

  it("serializes the structured report as JSON", async () => {
    const { chapters, set } = await loadMiniBook();
    const report = await runExtractionAxis({
      bookId: "mini-book",
      chapters,
      assertions: set,
      extract: fakeExtract,
      judge: createStubJudge({ defaultSupported: true }),
      gates: DEFAULT_GATES,
    });

    const parsed = JSON.parse(formatJsonReport(report)) as typeof report;

    expect(parsed.book).toBe("mini-book");
    expect(parsed.axis).toBe("extraction");
    expect(parsed.kinds).toHaveLength(9);
    expect(parsed.passed).toBe(true);
    expect(parsed.sweep.estimatedFabricationRate.mean).toBe(0);
  });
});
