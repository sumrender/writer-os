import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadAssertionSet } from "./lib/assertion-file.js";
import { ASSERTION_KINDS } from "./lib/assertions.js";
import { validateBook } from "./lib/manifest.js";
import { fakeExtract, fakeSynthesizeBible, fakeSynthesizeChapterSummary } from "./lib/fakes.js";
import { runExtraction } from "./lib/extraction-run.js";
import { emptyStoryFacts, type StoryFacts } from "./lib/story-facts.js";
import type { BibleSnapshot } from "./lib/story-bible.js";

const bookDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "books",
  "mini-book",
);

describe("mini-book fixture", () => {
  it("validates clean as a fixture book", () => {
    const result = validateBook(bookDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.book).toBe("mini-book");
      expect(result.chapters.map((c) => c.ordinal)).toEqual([1, 2, 3, 4]);
    }
  });

  it("loads a hand-computable assertion set covering every kind and both polarities", () => {
    const result = loadAssertionSet(bookDir, { maxOrdinal: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const kinds = new Set(result.set.assertions.map((a) => a.kind));
    expect([...kinds].sort()).toEqual([...ASSERTION_KINDS].sort());
    const expectations = new Set(result.set.assertions.map((a) => a.expect));
    expect(expectations).toEqual(new Set(["must", "must_not"]));
    for (const assertion of result.set.assertions) {
      if (assertion.expect === "must") {
        expect(assertion.evidence.length, assertion.id).toBeGreaterThan(0);
      }
    }
  });

  it("yields per-ordinal facts-state snapshots under sequential fake extraction", async () => {
    const book = validateBook(bookDir);
    if (!book.ok) throw new Error("fixture must validate");
    const snapshots = await runExtraction(book.chapters, fakeExtract);

    expect(snapshots.map((s) => s.afterOrdinal)).toEqual([1, 2, 3, 4]);

    const after1 = snapshots[0]?.facts;
    expect(after1?.characters.map((c) => c.name)).toEqual(["Mara Vey", "Joren Vey"]);
    expect(after1?.items).toEqual([]);
    expect(after1?.timeline).toEqual(["the harbor bell rang"]);

    const after2 = snapshots[1]?.facts;
    expect(after2?.items).toEqual([{ item: "brass compass", holder: "Mara Vey" }]);
    expect(after2?.threads).toEqual([{ thread: "the missing ledger", status: "open" }]);
    expect(after2?.lexicon).toEqual([{ term: "Vess", lockedSpelling: true }]);

    const after3 = snapshots[2]?.facts;
    expect(after3?.timeline).toEqual(["the harbor bell rang", "the ledger burned"]);
    expect(after3?.worldRules).toEqual([
      { topic: "the northern light burns without oil" },
    ]);

    const final = snapshots[3]?.facts;
    expect(final?.items).toEqual([{ item: "brass compass", holder: "Joren Vey" }]);
    expect(final?.threads).toEqual([{ thread: "the missing ledger", status: "resolved" }]);
    expect(final?.relationships).toEqual([
      { from: "Mara Vey", to: "Joren Vey", relationType: "daughter" },
      { from: "Joren Vey", to: "Mara Vey", relationType: "father" },
    ]);
    expect(final?.appearances).toEqual([
      { character: "Mara Vey", attribute: "her coat", contains: "salt-white wool" },
    ]);
    expect(final?.style).toEqual([
      { field: "narration", value: "close third person, past tense" },
    ]);
  });

  it("synthesizes a chapter summary and a full bible at every ordinal", async () => {
    const book = validateBook(bookDir);
    if (!book.ok) throw new Error("fixture must validate");

    const summaries: { ordinal: number; summary: string }[] = [];
    const bibleSnapshots: BibleSnapshot[] = [];
    let factsBefore: StoryFacts = emptyStoryFacts();
    await runExtraction(book.chapters, fakeExtract, undefined, {
      onChapterComplete: async ({ ordinal, facts }) => {
        const chapterText = book.chapters
          .slice()
          .sort((a, b) => a.ordinal - b.ordinal)
          .find((chapter) => chapter.ordinal === ordinal)?.text;
        if (chapterText === undefined) throw new Error(`no text for ordinal ${ordinal}`);
        summaries.push(
          await fakeSynthesizeChapterSummary({ ordinal, text: chapterText, factsSoFar: factsBefore }),
        );
        const bible = await fakeSynthesizeBible({
          chapters: book.chapters
            .slice()
            .sort((a, b) => a.ordinal - b.ordinal)
            .filter((chapter) => chapter.ordinal <= ordinal)
            .map((chapter) => chapter.text),
          facts,
          summaries: [...summaries],
        });
        bibleSnapshots.push({ afterOrdinal: ordinal, bible });
        factsBefore = facts;
      },
    });

    // Hand-computed chapter summaries: the facts each chapter's own lines
    // establish, rendered through the fake grammar's fact text.
    expect(summaries).toEqual([
      {
        ordinal: 1,
        summary: [
          'character named "Mara Vey"',
          'character named "Joren Vey"',
          '"Mara Vey" — her coat: salt-white wool',
          '"Mara Vey" is the "daughter" of "Joren Vey"',
          'location named "the northern light"',
          "in-world event happened: the harbor bell rang",
          'style guide sets narration to "close third person, past tense"',
        ].join("; "),
      },
      {
        ordinal: 2,
        summary: [
          'item "brass compass" is held by "Mara Vey"',
          'plot thread "the missing ledger" stands open',
          'lexicon term "Vess" (spelling locked)',
        ].join("; "),
      },
      {
        ordinal: 3,
        summary: [
          "world rule: the northern light burns without oil",
          "in-world event happened: the ledger burned",
        ].join("; "),
      },
      {
        ordinal: 4,
        summary: [
          '"Joren Vey" is the "father" of "Mara Vey"',
          'item "brass compass" is held by "Joren Vey"',
          'plot thread "the missing ledger" stands resolved',
        ].join("; "),
      },
    ]);

    expect(bibleSnapshots.map((s) => s.afterOrdinal)).toEqual([1, 2, 3, 4]);
    const finalBible = bibleSnapshots.at(-1)?.bible;
    expect(finalBible?.chapterSummaries).toEqual(summaries);
    // Placeholders: every model section ships valid and empty.
    expect(finalBible?.bookOverview).toBe("");
    expect(finalBible?.characterProfiles).toEqual([]);
    expect(finalBible?.locationProfiles).toEqual([]);
    // The derived graph: Mara Vey is mentioned 5 times, Joren Vey 4.
    expect(finalBible?.graph.nodes).toEqual([
      { name: "Mara Vey", importance: 5, role: "protagonist" },
      { name: "Joren Vey", importance: 4, role: "supporting" },
    ]);
    expect(finalBible?.graph.edges).toEqual([
      { from: "Mara Vey", to: "Joren Vey", relation: "daughter" },
      { from: "Joren Vey", to: "Mara Vey", relation: "father" },
    ]);
  });
});
