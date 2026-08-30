import { describe, expect, it } from "vitest";
import { emptyStoryFacts } from "./story-facts.js";
import { fakeCheck, fakeExtract, fakeGenerate, fakeSynthesizeBible, fakeSynthesizeChapterSummary } from "./fakes.js";
import { fakeModelSections } from "./bible-sections.js";

const CH1 = [
  "Introducing Mara Vey, keeper of the northern light.",
  "Introducing Joren Vey, once keeper before her.",
  "Mara Vey is the daughter of Joren Vey.",
  "",
  "Mara Vey is known for her coat: salt-white wool.",
].join("\n");

describe("fakeExtract", () => {
  it("parses every sentence template into its story fact", async () => {
    const text = [
      CH1,
      "The brass compass rests with Mara Vey.",
      "The matter of the missing ledger stands open.",
      "In this world, the northern light burns without oil.",
      "It happened that the harbor bell rang.",
      'Say always "Vess", never otherwise.',
      "Style decree — narration: close third person, past tense.",
      "The scene is set in the northern light.",
    ].join("\n");

    const state = await fakeExtract(text, 1, emptyStoryFacts());

    expect(state.characters.map((c) => c.name)).toEqual(["Mara Vey", "Joren Vey"]);
    expect(state.relationships).toEqual([
      { from: "Mara Vey", to: "Joren Vey", relationType: "daughter" },
    ]);
    expect(state.appearances).toEqual([
      { character: "Mara Vey", attribute: "her coat", contains: "salt-white wool" },
    ]);
    expect(state.items).toEqual([{ item: "brass compass", holder: "Mara Vey" }]);
    expect(state.locations).toEqual([{ name: "the northern light" }]);
    expect(state.threads).toEqual([
      { thread: "the missing ledger", status: "open" },
    ]);
    expect(state.worldRules.map((r) => r.topic)).toEqual([
      "the northern light burns without oil",
    ]);
    expect(state.timeline).toEqual(["the harbor bell rang"]);
    expect(state.lexicon).toEqual([{ term: "Vess", lockedSpelling: true }]);
    expect(state.style).toEqual([
      { field: "narration", value: "close third person, past tense" },
    ]);
  });

  it("replaces an item's holder instead of appending a second entry", async () => {
    const after = await fakeExtract("The brass compass rests with Mara Vey.", 2, emptyStoryFacts());
    const state = await fakeExtract("The brass compass rests with Joren Vey.", 4, after);

    expect(state.items).toEqual([{ item: "brass compass", holder: "Joren Vey" }]);
  });

  it("replaces a thread's status instead of appending a second entry", async () => {
    const open = await fakeExtract(
      "The matter of the missing ledger stands open.",
      2,
      emptyStoryFacts(),
    );
    const state = await fakeExtract(
      "The matter of the missing ledger stands resolved.",
      4,
      open,
    );

    expect(state.threads).toEqual([{ thread: "the missing ledger", status: "resolved" }]);
  });

  it("deduplicates identical facts and ignores prose outside the grammar", async () => {
    const once = await fakeExtract(
      `${CH1}\nIt happened that the harbor bell rang.\nShe watched the water swallow the sun.`,
      1,
      emptyStoryFacts(),
    );
    const twice = await fakeExtract(CH1, 2, once);

    expect(twice.characters.map((c) => c.name)).toEqual(["Mara Vey", "Joren Vey"]);
    expect(twice.timeline).toEqual(["the harbor bell rang"]);
  });

  it("is deterministic: identical inputs produce deep-equal states", async () => {
    const a = await fakeExtract(CH1, 1, emptyStoryFacts());
    const b = await fakeExtract(CH1, 1, emptyStoryFacts());

    expect(a).toEqual(b);
  });
});

describe("fakeCheck", () => {
  const canon = async (): Promise<Awaited<ReturnType<typeof fakeExtract>>> =>
    fakeExtract(
      [
        "The brass compass rests with Mara Vey.",
        "The matter of the missing ledger stands open.",
        "Mara Vey is the daughter of Joren Vey.",
      ].join("\n"),
      1,
      emptyStoryFacts(),
    );

  it("raises no flags for a chapter consistent with canon", async () => {
    const result = await fakeCheck(await canon(), "The brass compass rests with Mara Vey.");
    expect(result.flags).toEqual([]);
  });

  it("flags an item-holder contradiction, naming both values", async () => {
    const result = await fakeCheck(
      await canon(),
      "The brass compass rests with Bellin the harbormaster.",
    );
    expect(result.flags).toHaveLength(1);
    expect(result.flags[0]?.kind).toBe("item");
    expect(result.flags[0]?.message).toContain("brass compass");
    expect(result.flags[0]?.message).toContain("Mara Vey");
    expect(result.flags[0]?.message).toContain("Bellin the harbormaster");
  });

  it("flags relationship and thread contradictions", async () => {
    const state = await canon();
    const rel = await fakeCheck(state, "Mara Vey is the rival of Joren Vey.");
    expect(rel.flags.map((f) => f.kind)).toEqual(["relationship"]);

    const thread = await fakeCheck(state, "The matter of the missing ledger stands resolved.");
    expect(thread.flags.map((f) => f.kind)).toEqual(["thread"]);
  });

  it("is silent about facts absent from canon (rule-based, not semantic)", async () => {
    const result = await fakeCheck(await canon(), "Introducing Pell Wynn, a stranger in port.");
    expect(result.flags).toEqual([]);
  });
});

describe("fakeGenerate", () => {
  const context = (throughOrdinal: number) => ({
    throughOrdinal,
    assembledContext: `context through chapter ${throughOrdinal}`,
    factsAsOf: emptyStoryFacts(),
  });

  it("produces ordinal N+1 with deterministic text and no beats by default", async () => {
    const chapter = await fakeGenerate(context(3));
    expect(chapter.ordinal).toBe(4);
    expect(chapter.text).toContain("chapter 4");
    const again = await fakeGenerate(context(3));
    expect(chapter.text).toBe(again.text);
  });

  it("weaves each requested beat into the generated text verbatim", async () => {
    const chapter = await fakeGenerate(context(3), {
      beats: ["Mara signs the ledger", "the bell rings twice"],
    });
    expect(chapter.text).toContain("Mara signs the ledger");
    expect(chapter.text).toContain("the bell rings twice");
  });
});

describe("fakeSynthesizeChapterSummary", () => {
  it("renders only the chapter's own facts, joined with '; '", async () => {
    const summary = await fakeSynthesizeChapterSummary({
      ordinal: 1,
      text: CH1,
      factsSoFar: emptyStoryFacts(),
    });
    expect(summary).toEqual({
      ordinal: 1,
      summary: [
        'character named "Mara Vey"',
        'character named "Joren Vey"',
        '"Mara Vey" — her coat: salt-white wool',
        '"Mara Vey" is the "daughter" of "Joren Vey"',
      ].join("; "),
    });
  });

  it("summarizes a chapter establishing nothing as the empty string", async () => {
    const summary = await fakeSynthesizeChapterSummary({
      ordinal: 5,
      text: "She watched the water swallow the sun.",
      factsSoFar: emptyStoryFacts(),
    });
    expect(summary).toEqual({ ordinal: 5, summary: "" });
  });

  it("applies within-chapter replace semantics (holder swap)", async () => {
    const summary = await fakeSynthesizeChapterSummary({
      ordinal: 4,
      text: "The brass compass rests with Mara Vey.\nThe brass compass rests with Joren Vey.",
      factsSoFar: emptyStoryFacts(),
    });
    expect(summary.summary).toBe('item "brass compass" is held by "Joren Vey"');
  });

  it("is deterministic", async () => {
    const input = { ordinal: 1, text: CH1, factsSoFar: emptyStoryFacts() };
    expect(await fakeSynthesizeChapterSummary(input)).toEqual(
      await fakeSynthesizeChapterSummary(input),
    );
  });
});

describe("fakeSynthesizeBible", () => {
  it("carries the summaries, derives the graph, and seeds Locations from facts (issue #17)", async () => {
    const chapters = [
      "Introducing Mara Vey, keeper of the northern light.\nThe scene is set in the northern light.",
      "Introducing Joren Vey, once keeper before her.",
    ];
    const facts = await fakeExtract(chapters.join("\n"), 2, emptyStoryFacts());
    const summaries = [
      { ordinal: 1, summary: "Mara keeps the light." },
      { ordinal: 2, summary: "Joren arrives." },
    ];

    const bible = await fakeSynthesizeBible({ chapters, facts, summaries });

    expect(bible.chapterSummaries).toEqual(summaries);
    const { chapterSummaries: _carried, graph, locations: _locations, ...sections } = bible;
    const { locations: _fakeLocations, ...fakeWithoutLocations } = fakeModelSections();
    expect(sections).toEqual(fakeWithoutLocations);
    // Mara is named alongside the location in ch1; Joren is not — no co-occurrence.
    expect(bible.locations).toEqual([
      {
        name: "the northern light",
        description: "",
        significance: "",
        charactersSeen: [{ character: "Mara Vey", firstCoOccurrenceOrdinal: 1 }],
      },
    ]);
    expect(graph.nodes).toEqual([
      { name: "Mara Vey", importance: 1, role: "protagonist" },
      { name: "Joren Vey", importance: 1, role: "supporting" },
    ]);
    expect(graph.edges).toEqual([]);
  });

  it("emits no locations entries when the canon establishes none", async () => {
    const chapters = [
      "Introducing Mara Vey, keeper of the northern light.",
      "Introducing Joren Vey, once keeper before her.",
    ];
    const facts = emptyStoryFacts();
    const summaries = [{ ordinal: 1, summary: "n/a" }];

    const bible = await fakeSynthesizeBible({ chapters, facts, summaries });

    expect(bible.locations).toEqual([]);
  });
});
