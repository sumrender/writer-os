import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBook } from "../../lib/manifest.js";
import { loadAssertionSet } from "../../lib/assertion-file.js";
import { loadPerturbationSet } from "../../lib/perturbation-file.js";
import { fakeCheck, fakeExtract } from "../../lib/fakes.js";
import type { Check } from "../../lib/pipeline.js";
import { runCheckerAxis } from "./checker-axis.js";
import { formatCheckerJsonReport, formatCheckerTextReport } from "../report.js";

const booksRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "books");

async function loadMiniBook() {
  const book = validateBook(join(booksRoot, "mini-book"));
  if (!book.ok) throw new Error("mini-book fixture must validate");
  const assertions = loadAssertionSet(join(booksRoot, "mini-book"), { maxOrdinal: 4 });
  if (!assertions.ok) throw new Error("mini-book assertions must validate");
  const assertionIds = new Set(assertions.set.assertions.map((a) => a.id));
  const perturbations = loadPerturbationSet(join(booksRoot, "mini-book"), book.chapters, assertionIds);
  if (!perturbations.ok) throw new Error("mini-book perturbations must validate");
  return { chapters: book.chapters, cases: perturbations.cases };
}

describe("runCheckerAxis — mini-book fixtures via the fake checker", () => {
  it("catches every perturbation and raises no false positives on controls", async () => {
    const { chapters, cases } = await loadMiniBook();
    expect(cases).toHaveLength(4);

    const report = await runCheckerAxis({
      bookId: "mini-book",
      chapters,
      cases,
      extract: fakeExtract,
      check: fakeCheck,
    });

    expect(report.runs).toBe(3);
    expect(report.perturbationCatchRate).toEqual({ mean: 1, variance: 0 });
    expect(report.controlFalsePositiveRate).toEqual({ mean: 0, variance: 0 });
    expect(report.passed).toBe(true);

    const holderSwap = report.cases.find((c) => c.caseId === "ch03-holder-swap");
    expect(holderSwap).toMatchObject({ kind: "perturbation", expected: "flag" });
    expect(holderSwap?.raisedRate).toEqual({ mean: 1, variance: 0 });

    const control = report.cases.find((c) => c.caseId === "ch01-control");
    expect(control).toMatchObject({ kind: "control", expected: "no_flags" });
    expect(control?.raisedRate).toEqual({ mean: 0, variance: 0 });
  });

  it("reports both must-flag and must-not-flag outcomes across every case", async () => {
    const { chapters, cases } = await loadMiniBook();
    const report = await runCheckerAxis({
      bookId: "mini-book",
      chapters,
      cases,
      extract: fakeExtract,
      check: fakeCheck,
    });

    const perturbationOutcomes = report.cases.filter((c) => c.kind === "perturbation");
    const controlOutcomes = report.cases.filter((c) => c.kind === "control");
    expect(perturbationOutcomes.every((c) => c.raisedRate.mean === 1)).toBe(true);
    expect(controlOutcomes.every((c) => c.raisedRate.mean === 0)).toBe(true);
  });
});

describe("runCheckerAxis — vacuous conventions for an unauthored fixture set", () => {
  it("reports catch rate 1 and false-positive rate 0 when no cases exist", async () => {
    const { chapters } = await loadMiniBook();
    const report = await runCheckerAxis({
      bookId: "tom-sawyer",
      chapters,
      cases: [],
      extract: fakeExtract,
      check: fakeCheck,
    });

    expect(report.cases).toEqual([]);
    expect(report.perturbationCatchRate).toEqual({ mean: 1, variance: 0 });
    expect(report.controlFalsePositiveRate).toEqual({ mean: 0, variance: 0 });
    expect(report.passed).toBe(true);
  });
});

describe("runCheckerAxis — grading a checker that misbehaves", () => {
  it("fails the run when a perturbation goes uncaught", async () => {
    const { chapters, cases } = await loadMiniBook();
    const blindCheck: Check = async () => ({ flags: [] });

    const report = await runCheckerAxis({
      bookId: "mini-book",
      chapters,
      cases,
      extract: fakeExtract,
      check: blindCheck,
    });

    expect(report.perturbationCatchRate.mean).toBe(0);
    expect(report.passed).toBe(false);
  });

  it("fails the run when a control is falsely flagged", async () => {
    const { chapters, cases } = await loadMiniBook();
    const trigger: Check = async () => ({ flags: [{ kind: "item", message: "always suspicious" }] });

    const report = await runCheckerAxis({
      bookId: "mini-book",
      chapters,
      cases,
      extract: fakeExtract,
      check: trigger,
    });

    expect(report.controlFalsePositiveRate.mean).toBe(1);
    expect(report.passed).toBe(false);
  });

  it("carries the raised flag text into the report for diagnosis", async () => {
    const { chapters, cases } = await loadMiniBook();
    const trigger: Check = async () => ({
      flags: [{ kind: "thread", message: "canon says open; text says closed" }],
    });

    const report = await runCheckerAxis({
      bookId: "mini-book",
      chapters,
      cases,
      extract: fakeExtract,
      check: trigger,
    });

    for (const entry of report.cases) {
      expect(entry.flagMessages).toEqual(["canon says open; text says closed"]);
    }
  });
});

describe("runCheckerAxis — protocol guards", () => {
  it("rejects a non-positive run count up front", async () => {
    const { chapters, cases } = await loadMiniBook();
    await expect(
      runCheckerAxis({
        bookId: "mini-book",
        chapters,
        cases,
        extract: fakeExtract,
        check: fakeCheck,
        runs: 0,
      }),
    ).rejects.toThrow(/at least one run/i);
  });

  it("honors a custom run count", async () => {
    const { chapters, cases } = await loadMiniBook();
    const report = await runCheckerAxis({
      bookId: "mini-book",
      chapters,
      cases,
      extract: fakeExtract,
      check: fakeCheck,
      runs: 1,
    });
    expect(report.runs).toBe(1);
  });
});

describe("report formatting", () => {
  it("renders per-case rates, catch/false-positive rates, and gate status as text", async () => {
    const { chapters, cases } = await loadMiniBook();
    const report = await runCheckerAxis({
      bookId: "mini-book",
      chapters,
      cases,
      extract: fakeExtract,
      check: fakeCheck,
    });

    const text = formatCheckerTextReport(report).join("\n");

    expect(text).toContain("checker — mini-book");
    expect(text).toContain("runs: 3");
    expect(text).toContain("ch03-holder-swap");
    expect(text).toContain("ch01-control");
    expect(text).toContain("perturbation catch rate 1.000");
    expect(text).toContain("control false-positive rate 0.000");
    expect(text).toContain("gates: PASS");
  });

  it("reports an unauthored fixture set explicitly instead of an empty table", async () => {
    const { chapters } = await loadMiniBook();
    const report = await runCheckerAxis({
      bookId: "tom-sawyer",
      chapters,
      cases: [],
      extract: fakeExtract,
      check: fakeCheck,
    });

    const text = formatCheckerTextReport(report).join("\n");
    expect(text).toContain("no perturbation or control cases authored");
  });

  it("prints the offending flag text beneath any deviating case", async () => {
    const { chapters, cases } = await loadMiniBook();
    const report = await runCheckerAxis({
      bookId: "mini-book",
      chapters,
      cases,
      extract: fakeExtract,
      // Every call flags everything: clean controls become false positives.
      check: async () => ({ flags: [{ kind: "item", message: "canon clash: holder" }] }),
    });

    const text = formatCheckerTextReport(report).join("\n");

    expect(text).toContain("control false-positive rate 1.000");
    expect(text).toContain("flag: canon clash: holder");
  });

  it("serializes the structured report as JSON", async () => {
    const { chapters, cases } = await loadMiniBook();
    const report = await runCheckerAxis({
      bookId: "mini-book",
      chapters,
      cases,
      extract: fakeExtract,
      check: fakeCheck,
    });

    const parsed = JSON.parse(formatCheckerJsonReport(report)) as typeof report;

    expect(parsed.book).toBe("mini-book");
    expect(parsed.axis).toBe("checker");
    expect(parsed.cases).toHaveLength(4);
    expect(parsed.passed).toBe(true);
  });
});
