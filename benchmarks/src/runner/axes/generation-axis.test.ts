import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBook } from "../../lib/manifest.js";
import { loadBeatSet } from "../../lib/beat-file.js";
import { fakeCheck, fakeExtract, fakeGenerate } from "../../lib/fakes.js";
import { createStubJudge } from "../../lib/stub-judge.js";
import type { Check, Generate } from "../../lib/pipeline.js";
import { runGenerationAxis } from "./generation-axis.js";
import { formatGenerationJsonReport, formatGenerationTextReport } from "../report.js";

const booksRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "books");

async function loadMiniBook() {
  const book = validateBook(join(booksRoot, "mini-book"));
  if (!book.ok) throw new Error("mini-book fixture must validate");
  const beats = loadBeatSet(join(booksRoot, "mini-book"), { maxOrdinal: 4 });
  if (!beats.ok) throw new Error("mini-book beats must validate");
  return { chapters: book.chapters, beats: beats.set };
}

describe("runGenerationAxis — mini-book via the fake generator and checker", () => {
  it("dual-grades the declared beat chapter across three offline runs", async () => {
    const { chapters, beats } = await loadMiniBook();
    expect(beats.chapters).toHaveLength(1);
    expect(beats.chapters[0]?.ordinal).toBe(4);

    const report = await runGenerationAxis({
      bookId: "mini-book",
      chapters,
      beats,
      extract: fakeExtract,
      generate: fakeGenerate,
      check: fakeCheck,
      judge: createStubJudge({ defaultEquivalent: false }),
    });

    expect(report.book).toBe("mini-book");
    expect(report.axis).toBe("generation");
    expect(report.runs).toBe(3);
    expect(report.chapters).toHaveLength(1);

    const [chapterReport] = report.chapters;
    expect(chapterReport?.ordinal).toBe(4);
    expect(chapterReport?.beatFailureRate).toEqual({ mean: 0, variance: 0 });
    expect(chapterReport?.assemblyFailureRate).toEqual({ mean: 0, variance: 0 });
    expect(chapterReport?.factualFlags.mean).toBe(0);
    expect(chapterReport?.verdict).toEqual({ mean: 1, variance: 0 });
    expect(report.passed).toBe(true);
  });
});

describe("runGenerationAxis — vacuous conventions for an unauthored beat set", () => {
  it("reports a vacuous pass when no beat chapters exist", async () => {
    const { chapters } = await loadMiniBook();

    const report = await runGenerationAxis({
      bookId: "tom-sawyer",
      chapters,
      beats: { book: "tom-sawyer", chapters: [] },
      extract: fakeExtract,
      generate: fakeGenerate,
      check: fakeCheck,
      judge: createStubJudge(),
    });

    expect(report.chapters).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("carries deduped failure evidence on chapters whose runs were not clean", async () => {
    const { chapters, beats } = await loadMiniBook();
    const ignoringBeats: Generate = async (context) => ({
      ordinal: context.throughOrdinal + 1,
      text: "Nothing relevant happens.\n",
    });
    const flaggingCheck: Check = async () => ({
      flags: [{ kind: "style", message: "canon clash on narration" }],
    });

    const report = await runGenerationAxis({
      bookId: "mini-book",
      chapters,
      beats,
      extract: fakeExtract,
      generate: ignoringBeats,
      check: flaggingCheck,
      judge: createStubJudge({ defaultEquivalent: false }),
    });

    const [chapterReport] = report.chapters;
    expect(chapterReport?.missedBeats.length).toBeGreaterThan(0);
    expect(chapterReport?.flagMessages).toEqual(["style: canon clash on narration"]);

    const text = formatGenerationTextReport(report).join("\n");
    expect(text).toContain("missing beat:");
    expect(text).toContain("flag: style: canon clash on narration");
  });
});

describe("runGenerationAxis — distinguishing the two failure modes", () => {
  it("reports a beat-failure rate of 1 when the generator omits a required beat", async () => {
    const { chapters, beats } = await loadMiniBook();
    const ignoringBeats: Generate = async (context) => ({
      ordinal: context.throughOrdinal + 1,
      text: "Nothing relevant happens.\n",
    });

    const report = await runGenerationAxis({
      bookId: "mini-book",
      chapters,
      beats,
      extract: fakeExtract,
      generate: ignoringBeats,
      check: fakeCheck,
      judge: createStubJudge({ defaultEquivalent: false }),
    });

    const [chapterReport] = report.chapters;
    expect(chapterReport?.beatFailureRate).toEqual({ mean: 1, variance: 0 });
    expect(chapterReport?.assemblyFailureRate).toEqual({ mean: 0, variance: 0 });
    expect(chapterReport?.verdict).toEqual({ mean: 0, variance: 0 });
    expect(report.passed).toBe(false);
  });

  it("reports a beat-failure rate when a must_not_include beat appears verbatim", async () => {
    const { chapters, beats } = await loadMiniBook();
    const violatingGenerate: Generate = async (context) => ({
      ordinal: context.throughOrdinal + 1,
      text: "Mara Vey and Joren Vey are revealed as sisters.\n",
    });

    const report = await runGenerationAxis({
      bookId: "mini-book",
      chapters,
      beats,
      extract: fakeExtract,
      generate: violatingGenerate,
      check: fakeCheck,
      judge: createStubJudge(),
    });

    const [chapterReport] = report.chapters;
    expect(chapterReport?.beatFailureRate).toEqual({ mean: 1, variance: 0 });
    expect(chapterReport?.assemblyFailureRate).toEqual({ mean: 0, variance: 0 });
    expect(report.passed).toBe(false);
  });

  it("reports an assembly-failure rate when the checker flags the generated prose", async () => {
    const { chapters, beats } = await loadMiniBook();
    const contradicting: Generate = async (context) => ({
      ordinal: context.throughOrdinal + 1,
      text: [
        "The story turns on: the brass compass passes to Joren Vey.",
        "The story turns on: the missing ledger is resolved.",
        "The brass compass rests with Bellin the harbormaster.",
      ].join("\n"),
    });

    const report = await runGenerationAxis({
      bookId: "mini-book",
      chapters,
      beats,
      extract: fakeExtract,
      generate: contradicting,
      check: fakeCheck,
      judge: createStubJudge(),
    });

    const [chapterReport] = report.chapters;
    expect(chapterReport?.beatFailureRate).toEqual({ mean: 0, variance: 0 });
    expect(chapterReport?.assemblyFailureRate.mean).toBeGreaterThan(0);
    expect(chapterReport?.factualFlags.mean).toBeGreaterThan(0);
    expect(report.passed).toBe(false);
  });

  it("reports only assembly failures when the checker over-flags", async () => {
    const { chapters, beats } = await loadMiniBook();
    const trigger: Check = async () => ({
      flags: [{ kind: "item", message: "always suspicious" }],
    });

    const report = await runGenerationAxis({
      bookId: "mini-book",
      chapters,
      beats,
      extract: fakeExtract,
      generate: fakeGenerate,
      check: trigger,
      judge: createStubJudge(),
    });

    const [chapterReport] = report.chapters;
    expect(chapterReport?.beatFailureRate).toEqual({ mean: 0, variance: 0 });
    expect(chapterReport?.assemblyFailureRate).toEqual({ mean: 1, variance: 0 });
    expect(report.passed).toBe(false);
  });
});

describe("runGenerationAxis — protocol guards", () => {
  it("rejects a non-positive run count up front", async () => {
    const { chapters, beats } = await loadMiniBook();
    await expect(
      runGenerationAxis({
        bookId: "mini-book",
        chapters,
        beats,
        extract: fakeExtract,
        generate: fakeGenerate,
        check: fakeCheck,
        judge: createStubJudge(),
        runs: 0,
      }),
    ).rejects.toThrow(/at least one run/i);
  });

  it("honors a custom run count", async () => {
    const { chapters, beats } = await loadMiniBook();
    const report = await runGenerationAxis({
      bookId: "mini-book",
      chapters,
      beats,
      extract: fakeExtract,
      generate: fakeGenerate,
      check: fakeCheck,
      judge: createStubJudge({ defaultEquivalent: false }),
      runs: 1,
    });
    expect(report.runs).toBe(1);
  });
});

describe("report formatting", () => {
  it("renders per-chapter verdict and rates plus gate status as text", async () => {
    const { chapters, beats } = await loadMiniBook();
    const report = await runGenerationAxis({
      bookId: "mini-book",
      chapters,
      beats,
      extract: fakeExtract,
      generate: fakeGenerate,
      check: fakeCheck,
      judge: createStubJudge({ defaultEquivalent: false }),
    });

    const text = formatGenerationTextReport(report).join("\n");

    expect(text).toContain("generation — mini-book");
    expect(text).toContain("runs: 3");
    expect(text).toContain("chapter 4");
    expect(text).toContain("gates: PASS");
  });

  it("reports a vacuous beat set explicitly instead of an empty chapter table", async () => {
    const { chapters } = await loadMiniBook();
    const report = await runGenerationAxis({
      bookId: "tom-sawyer",
      chapters,
      beats: { book: "tom-sawyer", chapters: [] },
      extract: fakeExtract,
      generate: fakeGenerate,
      check: fakeCheck,
      judge: createStubJudge(),
    });

    const text = formatGenerationTextReport(report).join("\n");
    expect(text).toContain("no beat chapters declared");
  });

  it("renders per-chapter beat-failure rate when a generator omits beats", async () => {
    const { chapters, beats } = await loadMiniBook();
    const ignoringBeats: Generate = async (context) => ({
      ordinal: context.throughOrdinal + 1,
      text: "Nothing relevant happens.\n",
    });

    const report = await runGenerationAxis({
      bookId: "mini-book",
      chapters,
      beats,
      extract: fakeExtract,
      generate: ignoringBeats,
      check: fakeCheck,
      judge: createStubJudge({ defaultEquivalent: false }),
    });

    const text = formatGenerationTextReport(report).join("\n");
    expect(text).toContain("gates: FAIL");
    expect(text).toContain("beat failure rate 1.000");
  });

  it("serializes the structured report as JSON", async () => {
    const { chapters, beats } = await loadMiniBook();
    const report = await runGenerationAxis({
      bookId: "mini-book",
      chapters,
      beats,
      extract: fakeExtract,
      generate: fakeGenerate,
      check: fakeCheck,
      judge: createStubJudge({ defaultEquivalent: false }),
    });

    const parsed = JSON.parse(formatGenerationJsonReport(report)) as typeof report;

    expect(parsed.book).toBe("mini-book");
    expect(parsed.axis).toBe("generation");
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.passed).toBe(true);
    expect(parsed.chapters[0]?.ordinal).toBe(4);
  });
});