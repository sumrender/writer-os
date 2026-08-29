import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyStoryFacts, type StoryFacts } from "./story-facts.js";
import { loadAssertionSet } from "./assertion-file.js";
import { validateBook } from "./manifest.js";
import { runExtraction, type ExtractionSnapshot } from "./extraction-run.js";
import { fakeExtract } from "./fakes.js";
import { createStubJudge } from "./stub-judge.js";
import { gradeAssertionSet } from "./grader.js";
import { entryKey } from "./fact-text.js";
import type { Assertion, AssertionSet } from "./assertions.js";

const booksRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "books");

const asSet = (...assertions: Assertion[]): AssertionSet => ({ book: "test", assertions });

function loadMiniBook() {
  const book = validateBook(join(booksRoot, "mini-book"));
  if (!book.ok) throw new Error("mini-book fixture must validate");
  const assertions = loadAssertionSet(join(booksRoot, "mini-book"), { maxOrdinal: 4 });
  if (!assertions.ok) throw new Error("mini-book assertions must validate");
  return { chapters: book.chapters, set: assertions.set };
}

/** A writable facts store for building fixture states in tests. */
type WritableFacts = {
  -readonly [K in keyof StoryFacts]: StoryFacts[K] extends readonly (infer E)[]
    ? E[]
    : StoryFacts[K];
};

function singleState(mutate: (facts: WritableFacts) => void): ExtractionSnapshot[] {
  const facts = structuredClone(emptyStoryFacts()) as WritableFacts;
  mutate(facts);
  return [{ afterOrdinal: 1, facts }];
}

describe("gradeAssertionSet — deterministic path (no LLM)", () => {
  it("reproduces the mini-book's hand-computed perfect scores with zero judge calls", async () => {
    const { chapters, set } = loadMiniBook();
    const snapshots = await runExtraction(chapters, fakeExtract);
    const spy = createStubJudge();

    const graded = await gradeAssertionSet(set, snapshots, spy);

    expect(graded.finalOrdinal).toBe(4);
    expect(graded.graded.map((g) => g.verdict)).toEqual(
      expect.arrayContaining(["pass-exact"]),
    );
    expect(graded.graded.every((g) => g.verdict === "pass-exact")).toBe(true);
    expect(spy.calls).toEqual({ equivalence: 0, support: 0 });

    const mustCount = new Map<string, number>();
    for (const g of graded.graded) {
      if (g.expect !== "must") continue;
      mustCount.set(g.kind, (mustCount.get(g.kind) ?? 0) + 1);
    }
    expect(mustCount.get("character")).toBe(2);
    for (const kind of [
      "appearance",
      "relationship",
      "item",
      "location",
      "thread",
      "world_rule",
      "timeline",
      "lexicon",
      "style",
    ]) {
      expect(mustCount.get(kind), kind).toBe(1);
    }
  });

  it("claims exactly the matched facts, leaving the unasserted father relationship for the sweep", async () => {
    const { chapters, set } = loadMiniBook();
    const snapshots = await runExtraction(chapters, fakeExtract);

    const graded = await gradeAssertionSet(set, snapshots, createStubJudge());

    expect(graded.claimedKeys.size).toBe(12);
    const claimedRelationships = graded.finalFacts.relationships
      .map((r) => entryKey("relationship", r))
      .filter((key) => graded.claimedKeys.has(key));
    expect(claimedRelationships).toHaveLength(1);
    expect(claimedRelationships[0]).toContain("daughter");
  });

  it("marks every unmet must assertion as an omission on an empty facts store", async () => {
    const { set } = loadMiniBook();
    const snapshots: ExtractionSnapshot[] = [{ afterOrdinal: 4, facts: emptyStoryFacts() }];

    const graded = await gradeAssertionSet(set, snapshots, createStubJudge());

    expect(graded.graded.filter((g) => g.verdict === "omission")).toHaveLength(11);
  });
});

describe("gradeAssertionSet — deterministic-only fields never reach the judge", () => {
  it("rejects a misspelled lexicon term without consulting the judge", async () => {
    const spy = createStubJudge({ defaultEquivalent: true });
    const snapshots = singleState((b) => {
      b.lexicon.push({ term: "Vesss", lockedSpelling: true });
    });

    const graded = await gradeAssertionSet(asSet(lexiconAssertion()), snapshots, spy);

    expect(graded.graded[0]?.verdict).toBe("omission");
    expect(spy.calls.equivalence).toBe(0);
  });

  it("rejects an altered item holder without consulting the judge", async () => {
    const spy = createStubJudge({ defaultEquivalent: true });
    const snapshots = singleState((b) => {
      b.items.push({ item: "brass compass", holder: "Mara V." });
    });

    const graded = await gradeAssertionSet(asSet(itemHolderAssertion()), snapshots, spy);

    expect(graded.graded[0]?.verdict).toBe("omission");
    expect(spy.calls.equivalence).toBe(0);
  });

  it("rejects a wrong thread status without consulting the judge", async () => {
    const spy = createStubJudge({ defaultEquivalent: true });
    const snapshots = singleState((b) => {
      b.threads.push({ thread: "the missing ledger", status: "open" });
    });

    const graded = await gradeAssertionSet(asSet(threadStatusAssertion()), snapshots, spy);

    expect(graded.graded[0]?.verdict).toBe("omission");
    expect(spy.calls.equivalence).toBe(0);
  });
});

describe("gradeAssertionSet — judgable fields route to the equivalence judge", () => {
  it("accepts a paraphrased relationship type only when the judge calls it equivalent", async () => {
    const yesJudge = createStubJudge({
      equivalences: [{ left: "daughter", right: "child of", equivalent: true }],
    });
    const noJudge = createStubJudge({
      equivalences: [{ left: "daughter", right: "child of", equivalent: false }],
    });
    const snapshots = singleState((b) => {
      b.relationships.push({ from: "Mara Vey", to: "Joren Vey", relationType: "child of" });
    });

    const accepted = await gradeAssertionSet(asSet(daughterAssertion()), snapshots, yesJudge);
    const rejected = await gradeAssertionSet(asSet(daughterAssertion()), snapshots, noJudge);

    expect(accepted.graded[0]?.verdict).toBe("pass-judged");
    expect(rejected.graded[0]?.verdict).toBe("omission");
  });

  it("leaves a must_not near-miss untriggered and unclaimed — sweep material, not a fabrication", async () => {
    const judge = createStubJudge({
      equivalences: [{ left: "iron ships", right: "vessels of iron", equivalent: true }],
    });
    const snapshots = singleState((b) => {
      b.worldRules.push({ topic: "vessels of iron" });
    });

    const graded = await gradeAssertionSet(asSet(noIronShipsAssertion()), snapshots, judge);

    expect(graded.graded[0]?.verdict).toBe("pass-exact");
    const vesselsKey = graded.finalFacts.worldRules
      .map((r) => entryKey("world_rule", r))
      .filter((key) => !graded.claimedKeys.has(key));
    expect(vesselsKey).toHaveLength(1);
  });

  it("never consults the judge for must_not probes — they are exact tripwires", async () => {
    const hostileJudge = createStubJudge({ defaultEquivalent: true });
    const snapshots = singleState((b) => {
      b.worldRules.push({ topic: "vessels of iron" });
    });

    const graded = await gradeAssertionSet(asSet(noIronShipsAssertion()), snapshots, hostileJudge);

    expect(graded.graded[0]?.verdict).toBe("pass-exact");
    expect(hostileJudge.calls.equivalence).toBe(0);
  });

  it("aligns reworded timeline events through the judge but keeps order strictness", async () => {
    const judge = createStubJudge({
      equivalences: [
        { left: "the harbor bell rang", right: "a bell sounded over the harbor", equivalent: true },
        { left: "the ledger burned", right: "the ledger went up in flames", equivalent: true },
      ],
    });
    const inOrder = singleState((b) => {
      b.timeline.push("a bell sounded over the harbor", "the ledger went up in flames");
    });
    const swapped = singleState((b) => {
      b.timeline.push("the ledger went up in flames", "a bell sounded over the harbor");
    });

    const matched = await gradeAssertionSet(asSet(timelineAssertion()), inOrder, judge);
    const misordered = await gradeAssertionSet(asSet(timelineAssertion()), swapped, judge);

    expect(matched.graded[0]?.verdict).toBe("pass-judged");
    expect(misordered.graded[0]?.verdict).toBe("omission");
  });
});

describe("gradeAssertionSet — as_of grading window", () => {
  it("grades an as_of assertion against that ordinal's snapshot, not the final state", async () => {
    const snapshots: ExtractionSnapshot[] = [
      { afterOrdinal: 2, facts: withItem("brass compass", "Mara Vey") },
      { afterOrdinal: 3, facts: withItem("brass compass", "Mara Vey") },
      { afterOrdinal: 4, facts: withItem("brass compass", "Joren Vey") },
    ];

    const at3 = await gradeAssertionSet(asSet(itemHolderAsOf3()), snapshots, createStubJudge());
    const atFinal = await gradeAssertionSet(asSet(itemHolderFinal()), snapshots, createStubJudge());

    expect(at3.graded[0]?.verdict).toBe("omission");
    expect(atFinal.graded[0]?.verdict).toBe("pass-exact");
  });

  it("refuses to grade when the as_of ordinal has no snapshot", async () => {
    const snapshots = singleState(() => {});

    await expect(
      gradeAssertionSet(asSet(itemHolderAsOf3()), snapshots, createStubJudge()),
    ).rejects.toThrow(/as_of 3/);
  });
});

// -- assertion builders ------------------------------------------------------

const mustBase = { expect: "must" as const, evidence: [1] };

function daughterAssertion(): Assertion {
  return {
    ...mustBase,
    id: "rel-daughter",
    kind: "relationship",
    from: "Mara Vey",
    to: "Joren Vey",
    relationType: "daughter",
  };
}

function lexiconAssertion(): Assertion {
  return { ...mustBase, id: "lex-vess", kind: "lexicon", term: "Vess", lockedSpelling: true };
}

function itemHolderAssertion(): Assertion {
  return {
    ...mustBase,
    id: "item-compass",
    kind: "item",
    item: "brass compass",
    holder: "Mara Vey",
  };
}

function itemHolderAsOf3(): Assertion {
  return {
    id: "item-compass-asof3",
    kind: "item",
    expect: "must",
    asOf: 3,
    evidence: [2],
    item: "brass compass",
    holder: "Joren Vey",
  };
}

function itemHolderFinal(): Assertion {
  return {
    id: "item-compass-final",
    kind: "item",
    expect: "must",
    evidence: [4],
    item: "brass compass",
    holder: "Joren Vey",
  };
}

function threadStatusAssertion(): Assertion {
  return {
    ...mustBase,
    id: "thread-ledger",
    kind: "thread",
    thread: "the missing ledger",
    status: "resolved",
  };
}

function noIronShipsAssertion(): Assertion {
  return {
    id: "rule-no-iron-ships",
    kind: "world_rule",
    expect: "must_not",
    evidence: [],
    topic: "iron ships",
  };
}

function timelineAssertion(): Assertion {
  return {
    ...mustBase,
    id: "order-bell-before-burn",
    kind: "timeline",
    sequence: ["the harbor bell rang", "the ledger burned"],
  };
}

function withItem(item: string, holder: string): StoryFacts {
  const facts = structuredClone(emptyStoryFacts()) as WritableFacts;
  facts.items.push({ item, holder });
  return facts;
}
