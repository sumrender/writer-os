import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateBook } from "./lib/manifest.js";
import { fakeSynthesizeBible } from "./lib/fakes.js";
import { emptyStoryFacts, type StoryFacts } from "./lib/story-facts.js";

const bookDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "books",
  "tom-sawyer",
);

/**
 * The Tom Sawyer fixture (Project Gutenberg #74) is not written in the fake's
 * `Introducing ...` grammar, so the fake's `fakeExtract` would yield an empty
 * canon and the locations derivation would be empty. Issue #17 still requires
 * a populated locations section grounded in the fixture's canon. We therefore
 * hand-author the canon — every character and location name below is the
 * exact spelling in `books/tom-sawyer/assertions.yml` (which mandates curly
 * apostrophes for Jackson's Island and McDougal's cave, matching the source).
 * The chapter texts come from the source fixture; the fake's
 * `deriveLocationProfiles` produces the co-occurrence ordinals by the same
 * regex the production path uses. The negative probe ("New Orleans" never
 * appears) is exercised by leaving it out of the canon: an absent location
 * fact never produces a derived entry.
 */
const TOM_SAWYER_FACTS: StoryFacts = {
  ...emptyStoryFacts(),
  characters: [
    { name: "Tom Sawyer" },
    { name: "Huckleberry Finn" },
    { name: "Aunt Polly" },
    { name: "Sid" },
    { name: "Mary" },
    { name: "Becky Thatcher" },
    { name: "Injun Joe" },
    { name: "Muff Potter" },
    { name: "Judge Thatcher" },
    { name: "Widow Douglas" },
  ],
  locations: [
    { name: "St. Petersburg" },
    { name: "Jackson\u2019s Island" },
    { name: "McDougal\u2019s cave" },
  ],
};

interface ExpectedSeen {
  readonly character: string;
  readonly firstCoOccurrenceOrdinal: number;
}

interface ExpectedLocation {
  readonly name: string;
  readonly description: string;
  readonly significance: string;
  readonly charactersSeen: readonly ExpectedSeen[];
}

const FINAL_LOCATIONS: readonly ExpectedLocation[] = [
  {
    name: "St. Petersburg",
    description: "",
    significance: "",
    charactersSeen: [
      { character: "Tom Sawyer", firstCoOccurrenceOrdinal: 5 },
      { character: "Huckleberry Finn", firstCoOccurrenceOrdinal: 6 },
      { character: "Aunt Polly", firstCoOccurrenceOrdinal: 1 },
      { character: "Sid", firstCoOccurrenceOrdinal: 1 },
      { character: "Mary", firstCoOccurrenceOrdinal: 5 },
      { character: "Becky Thatcher", firstCoOccurrenceOrdinal: 6 },
      { character: "Judge Thatcher", firstCoOccurrenceOrdinal: 35 },
      { character: "Widow Douglas", firstCoOccurrenceOrdinal: 35 },
    ],
  },
  {
    name: "Jackson\u2019s Island",
    description: "",
    significance: "",
    charactersSeen: [
      { character: "Tom Sawyer", firstCoOccurrenceOrdinal: 13 },
      { character: "Huckleberry Finn", firstCoOccurrenceOrdinal: 13 },
    ],
  },
  {
    name: "McDougal\u2019s cave",
    description: "",
    significance: "",
    charactersSeen: [
      { character: "Tom Sawyer", firstCoOccurrenceOrdinal: 29 },
      { character: "Huckleberry Finn", firstCoOccurrenceOrdinal: 29 },
      { character: "Aunt Polly", firstCoOccurrenceOrdinal: 33 },
      { character: "Sid", firstCoOccurrenceOrdinal: 29 },
      { character: "Mary", firstCoOccurrenceOrdinal: 29 },
      { character: "Injun Joe", firstCoOccurrenceOrdinal: 29 },
      { character: "Judge Thatcher", firstCoOccurrenceOrdinal: 29 },
      { character: "Widow Douglas", firstCoOccurrenceOrdinal: 29 },
    ],
  },
];

describe("tom-sawyer fixture — locations slice (issue #17)", () => {
  it("validates clean as a fixture book", () => {
    const result = validateBook(bookDir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.book).toBe("tom-sawyer");
      expect(result.chapters.map((c) => c.ordinal)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
        23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
      ]);
    }
  });

  it("derives populated locations content at the final ordinal, grounded in the canon", async () => {
    const book = validateBook(bookDir);
    if (!book.ok) throw new Error("fixture must validate");
    const chaptersInOrder = [...book.chapters].sort((a, b) => a.ordinal - b.ordinal);
    const finalBible = await fakeSynthesizeBible({
      chapters: chaptersInOrder.map((chapter) => chapter.text),
      facts: TOM_SAWYER_FACTS,
      summaries: [],
    });
    expect(finalBible.locations).toEqual(FINAL_LOCATIONS);
  });

  it("derives Jackson's Island and McDougal's cave entries at their evidence ordinals", async () => {
    const book = validateBook(bookDir);
    if (!book.ok) throw new Error("fixture must validate");
    const chaptersInOrder = [...book.chapters].sort((a, b) => a.ordinal - b.ordinal);
    const chaptersThrough13 = chaptersInOrder
      .filter((chapter) => chapter.ordinal <= 13)
      .map((chapter) => chapter.text);
    const bibleAt13 = await fakeSynthesizeBible({
      chapters: chaptersThrough13,
      facts: TOM_SAWYER_FACTS,
      summaries: [],
    });

    const stPetersburg = bibleAt13.locations.find(
      (location) => location.name === "St. Petersburg",
    );
    const jacksonsIsland = bibleAt13.locations.find(
      (location) => location.name === "Jackson\u2019s Island",
    );
    const mcdougalsCave = bibleAt13.locations.find(
      (location) => location.name === "McDougal\u2019s cave",
    );

    expect(stPetersburg?.charactersSeen).toEqual([
      { character: "Tom Sawyer", firstCoOccurrenceOrdinal: 5 },
      { character: "Huckleberry Finn", firstCoOccurrenceOrdinal: 6 },
      { character: "Aunt Polly", firstCoOccurrenceOrdinal: 1 },
      { character: "Sid", firstCoOccurrenceOrdinal: 1 },
      { character: "Mary", firstCoOccurrenceOrdinal: 5 },
      { character: "Becky Thatcher", firstCoOccurrenceOrdinal: 6 },
    ]);
    expect(jacksonsIsland?.charactersSeen).toEqual([
      { character: "Tom Sawyer", firstCoOccurrenceOrdinal: 13 },
      { character: "Huckleberry Finn", firstCoOccurrenceOrdinal: 13 },
    ]);
    expect(mcdougalsCave?.charactersSeen).toEqual([]);
  });

  it("does not invent a location absent from the canon facts (the New Orleans negative probe)", async () => {
    const book = validateBook(bookDir);
    if (!book.ok) throw new Error("fixture must validate");
    const chaptersInOrder = [...book.chapters].sort((a, b) => a.ordinal - b.ordinal);
    const finalBible = await fakeSynthesizeBible({
      chapters: chaptersInOrder.map((chapter) => chapter.text),
      facts: TOM_SAWYER_FACTS,
      summaries: [],
    });
    const names = finalBible.locations.map((location) => location.name);
    expect(names).not.toContain("New Orleans");
    expect(names).toEqual([
      "St. Petersburg",
      "Jackson\u2019s Island",
      "McDougal\u2019s cave",
    ]);
  });
});
