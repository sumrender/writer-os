import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateBook } from "./lib/manifest.js";
import { fakeExtract, fakeSynthesizeBible, fakeSynthesizeChapterSummary } from "./lib/fakes.js";
import { runExtraction } from "./lib/extraction-run.js";
import { emptyStoryFacts, type StoryFacts } from "./lib/story-facts.js";
import type { BibleSnapshot } from "./lib/story-bible.js";
import { validateWorld } from "./lib/world-section.js";

/**
 * Tom Sawyer through the deterministic fakes (issue #16): the World slice
 * must render populated content at multiple ordinals of a full Fixture book
 * run — a realist novel, so the fake classifies the world earth and states
 * the relation to real-world rules without inventing supernatural canon.
 */

const bookDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "books",
  "tom-sawyer",
);

describe("tom-sawyer fake run — World slice", () => {
  it("renders populated, canon-supported world content at multiple ordinals", async () => {
    const book = validateBook(bookDir);
    if (!book.ok) throw new Error(`tom-sawyer must validate: ${JSON.stringify(book)}`);
    const ordered = [...book.chapters].sort((a, b) => a.ordinal - b.ordinal);

    const summaries: { ordinal: number; summary: string }[] = [];
    const bibleSnapshots: BibleSnapshot[] = [];
    const canonByOrdinal = new Map<number, StoryFacts>();
    let factsBefore: StoryFacts = emptyStoryFacts();
    await runExtraction(book.chapters, fakeExtract, undefined, {
      onChapterComplete: async ({ ordinal, facts }) => {
        const chapterText = ordered.find((chapter) => chapter.ordinal === ordinal)?.text;
        if (chapterText === undefined) throw new Error(`no text for ordinal ${ordinal}`);
        summaries.push(
          await fakeSynthesizeChapterSummary({ ordinal, text: chapterText, factsSoFar: factsBefore }),
        );
        const bible = await fakeSynthesizeBible({
          chapters: ordered
            .filter((chapter) => chapter.ordinal <= ordinal)
            .map((chapter) => chapter.text),
          facts,
          summaries: [...summaries],
        });
        bibleSnapshots.push({ afterOrdinal: ordinal, bible });
        canonByOrdinal.set(ordinal, facts);
        factsBefore = facts;
      },
    });

    expect(bibleSnapshots.map((s) => s.afterOrdinal)).toEqual(
      ordered.map((chapter) => chapter.ordinal),
    );

    // Populated at every ordinal: classification, description, and rules all
    // present and non-empty once the world is established — and every
    // section survives its own canon-support validation.
    for (const snapshot of bibleSnapshots) {
      const { world } = snapshot.bible;
      expect(world.classification).not.toBe("");
      expect(world.description).not.toBe("");
      expect(world.rules.length).toBeGreaterThan(0);
      const canon = canonByOrdinal.get(snapshot.afterOrdinal) ?? emptyStoryFacts();
      expect(() => validateWorld(world, canon)).not.toThrow();
    }

    // A realist novel: the fake never invents a supernatural classification.
    const classifications = new Set(bibleSnapshots.map((s) => s.bible.world.classification));
    expect([...classifications]).toEqual(["earth"]);
    for (const snapshot of bibleSnapshots) {
      for (const rule of snapshot.bible.world.rules) {
        expect(rule.relation).toBe("same_as_earth");
      }
    }

    // Content grows with the run: the description tracks the ordinal reached.
    expect(bibleSnapshots[0]?.bible.world.description).toContain("as of chapter 1");
    expect(bibleSnapshots.at(-1)?.bible.world.description).toContain(
      `as of chapter ${ordered.length}`,
    );
  });
});
