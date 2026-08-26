import { describe, expect, it } from "vitest";
import { emptyBible } from "./bible.js";
import { fakeCheck, fakeExtract, fakeGenerate } from "./fakes.js";

const CH1 = [
  "Introducing Mara Vey, keeper of the northern light.",
  "Introducing Joren Vey, once keeper before her.",
  "Mara Vey is the daughter of Joren Vey.",
  "",
  "Mara Vey is known for her coat: salt-white wool.",
].join("\n");

describe("fakeExtract", () => {
  it("parses every sentence template into its bible fact", async () => {
    const text = [
      CH1,
      "The brass compass rests with Mara Vey.",
      "The matter of the missing ledger stands open.",
      "In this world, the northern light burns without oil.",
      "It happened that the harbor bell rang.",
      'Say always "Vess", never otherwise.',
      "Style decree — narration: close third person, past tense.",
    ].join("\n");

    const state = await fakeExtract(text, 1, emptyBible());

    expect(state.characters.map((c) => c.name)).toEqual(["Mara Vey", "Joren Vey"]);
    expect(state.relationships).toEqual([
      { from: "Mara Vey", to: "Joren Vey", relationType: "daughter" },
    ]);
    expect(state.appearances).toEqual([
      { character: "Mara Vey", attribute: "her coat", contains: "salt-white wool" },
    ]);
    expect(state.items).toEqual([{ item: "brass compass", holder: "Mara Vey" }]);
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
    const after = await fakeExtract("The brass compass rests with Mara Vey.", 2, emptyBible());
    const state = await fakeExtract("The brass compass rests with Joren Vey.", 4, after);

    expect(state.items).toEqual([{ item: "brass compass", holder: "Joren Vey" }]);
  });

  it("replaces a thread's status instead of appending a second entry", async () => {
    const open = await fakeExtract(
      "The matter of the missing ledger stands open.",
      2,
      emptyBible(),
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
      emptyBible(),
    );
    const twice = await fakeExtract(CH1, 2, once);

    expect(twice.characters.map((c) => c.name)).toEqual(["Mara Vey", "Joren Vey"]);
    expect(twice.timeline).toEqual(["the harbor bell rang"]);
  });

  it("is deterministic: identical inputs produce deep-equal states", async () => {
    const a = await fakeExtract(CH1, 1, emptyBible());
    const b = await fakeExtract(CH1, 1, emptyBible());

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
      emptyBible(),
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
    bibleStateAsOf: emptyBible(),
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
