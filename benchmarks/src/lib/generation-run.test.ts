import { describe, expect, it } from "vitest";
import { runExtraction } from "./extraction-run.js";
import { runGenerationCases } from "./generation-run.js";
import { fakeCheck, fakeExtract, fakeGenerate } from "./fakes.js";
import { createStubJudge } from "./stub-judge.js";
import type { BeatChapter } from "./beats.js";
import type { Check, Generate } from "./pipeline.js";

const CHAPTERS = [
  { ordinal: 1, text: "The brass compass rests with Mara Vey." },
  { ordinal: 2, text: "The matter of the missing ledger stands open." },
  { ordinal: 3, text: "It happened that the ledger burned." },
];

const chapter = (overrides: Partial<BeatChapter> = {}): BeatChapter => ({
  ordinal: 4,
  mustInclude: [],
  mustNotInclude: [],
  ...overrides,
});

describe("runGenerationCases", () => {
  it("assembles context strictly before the beat's ordinal and passes it to generate", async () => {
    const snapshots = await runExtraction(CHAPTERS, fakeExtract);
    let receivedThroughOrdinal: number | undefined;
    let receivedContext: string | undefined;
    const spyGenerate: Generate = async (context) => {
      receivedThroughOrdinal = context.throughOrdinal;
      receivedContext = context.assembledContext;
      return { ordinal: context.throughOrdinal + 1, text: "Anything happens.\n" };
    };

    await runGenerationCases(
      [chapter()],
      snapshots,
      spyGenerate,
      fakeCheck,
      createStubJudge(),
    );

    expect(receivedThroughOrdinal).toBe(3);
    expect(receivedContext).toContain("brass compass");
    expect(receivedContext).toContain("missing ledger");
  });

  it("assembles the empty-canon marker for a beat declared at ordinal 1", async () => {
    let receivedContext: string | undefined;
    const spyGenerate: Generate = async (context) => {
      receivedContext = context.assembledContext;
      return { ordinal: context.throughOrdinal + 1, text: "Anything.\n" };
    };

    await runGenerationCases(
      [chapter({ ordinal: 1 })],
      [],
      spyGenerate,
      fakeCheck,
      createStubJudge(),
    );

    expect(receivedContext).toBe("(no canon established yet)");
  });

  it("passes must_include beats as generation intent", async () => {
    let receivedBeats: readonly string[] | undefined;
    const spyGenerate: Generate = async (context, intent) => {
      receivedBeats = intent?.beats;
      return { ordinal: context.throughOrdinal + 1, text: "Prose.\n" };
    };

    await runGenerationCases(
      [chapter({ ordinal: 1, mustInclude: ["the compass changes hands"] })],
      [],
      spyGenerate,
      fakeCheck,
      createStubJudge(),
    );

    expect(receivedBeats).toEqual(["the compass changes hands"]);
  });

  it("grades the generated chapter's beats and factual flags together", async () => {
    const snapshots = await runExtraction(CHAPTERS, fakeExtract);

    const [result] = await runGenerationCases(
      [
        chapter({
          mustInclude: ["the ledger burned"],
          mustNotInclude: ["a dragon appears"],
        }),
      ],
      snapshots,
      fakeGenerate,
      fakeCheck,
      createStubJudge(),
    );

    expect(result?.ordinal).toBe(4);
    expect(result?.generatedText).toContain("the ledger burned");
    expect(result?.missingBeats).toEqual([]);
    expect(result?.violatedBeats).toEqual([]);
    expect(result?.factualFlags).toEqual([]);
  });

  it("reports a missing beat when the generator omits it", async () => {
    const noBeatsGenerate: Generate = async (context) => ({
      ordinal: context.throughOrdinal + 1,
      text: "Nothing relevant happens.\n",
    });

    const [result] = await runGenerationCases(
      [chapter({ ordinal: 1, mustInclude: ["the ledger burned"] })],
      [],
      noBeatsGenerate,
      fakeCheck,
      createStubJudge({ defaultEquivalent: false }),
    );

    expect(result?.missingBeats).toEqual(["the ledger burned"]);
  });

  it("reports factual flags raised by the checker against the assembled canon", async () => {
    const snapshots = await runExtraction(CHAPTERS, fakeExtract);
    const contradicting: Generate = async (context) => ({
      ordinal: context.throughOrdinal + 1,
      text: "The brass compass rests with Bellin the harbormaster.\n",
    });

    const [result] = await runGenerationCases(
      [chapter()],
      snapshots,
      contradicting,
      fakeCheck,
      createStubJudge(),
    );

    expect(result?.factualFlags).toHaveLength(1);
    expect(result?.factualFlags[0]?.kind).toBe("item");
  });

  it("processes every declared beat chapter, one generation call each", async () => {
    const calls: number[] = [];
    const countingGenerate: Generate = async (context) => {
      calls.push(context.throughOrdinal);
      return { ordinal: context.throughOrdinal + 1, text: "Prose.\n" };
    };

    const snapshots = await runExtraction(CHAPTERS, fakeExtract);
    const results = await runGenerationCases(
      [chapter({ ordinal: 2 }), chapter({ ordinal: 4 })],
      snapshots,
      countingGenerate,
      fakeCheck,
      createStubJudge(),
    );

    expect(calls).toEqual([1, 3]);
    expect(results.map((r) => r.ordinal)).toEqual([2, 4]);
  });
});
