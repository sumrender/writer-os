import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadAssertionSet } from "./lib/assertion-file.js";
import { maxOrdinal, validateBook, type ValidatedChapter } from "./lib/manifest.js";
import { fakeSynthesizeBible } from "./lib/fakes.js";
import { applyFact, type ExtractedFact } from "./lib/fact-merge.js";
import { emptyStoryFacts, type StoryFacts } from "./lib/story-facts.js";
import { storyFacts } from "./lib/fact-text.js";
import type { Assertion } from "./lib/assertions.js";
import type { Extract, SynthesisStrategy, SynthesizeChapterSummary } from "./lib/pipeline.js";
import { createStubJudge } from "./lib/stub-judge.js";
import { DEFAULT_GATES } from "./lib/gates.js";
import { runExtractionAxis, type ExtractionAxisReport } from "./runner/axes/extraction-axis.js";
import type { BenchmarkEvent, ChapterCompletedEvent, RunCompletedEvent } from "./runner/events.js";

/**
 * End-to-end verification of the Tom Sawyer extraction axis over the offline
 * fakes (issue #21 — the integration ticket). The rule-based `fakeExtract`
 * yields an empty canon on classic prose (the fixture is not written in the
 * fake's sentence grammar), so this run drives a deterministic canon fake that
 * reconstructs Story Facts from the human-authored assertion set: every `must`
 * fact is applied at its first evidence ordinal, every `must_not` probe is left
 * out of canon. That pins the graded ground truth to the assertion set and lets
 * the run exercise the WHOLE axis plumbing — sequential extraction, per-ordinal
 * synthesis, grading, per-kind metrics, the open-world sweep, and gates — over a
 * full 36-chapter fixture with a populated Story Facts store and a populated
 * Story Bible at every ordinal. The vendor path is characterized separately by
 * the live mini-book run recorded in docs/TESTING.md §9.4.
 */

const bookDir = join(dirname(fileURLToPath(import.meta.url)), "..", "books", "tom-sawyer");

/** The facts one `must` assertion establishes, and the ordinal each lands at. */
function scheduledFacts(assertion: Assertion): readonly { ordinal: number; fact: ExtractedFact }[] {
  const first = assertion.evidence[0] ?? 1;
  const at = (fact: ExtractedFact) => [{ ordinal: first, fact }];
  switch (assertion.kind) {
    case "character":
      return at({ kind: "character", name: assertion.name });
    case "appearance":
      return at({
        kind: "appearance",
        character: assertion.character,
        attribute: assertion.attribute,
        contains: assertion.contains,
      });
    case "relationship":
      return at({
        kind: "relationship",
        from: assertion.from,
        to: assertion.to,
        relationType: assertion.relationType,
      });
    case "item":
      return at({ kind: "item", item: assertion.item, holder: assertion.holder });
    case "location":
      return at({ kind: "location", name: assertion.name });
    case "thread":
      return at({ kind: "thread", thread: assertion.thread, status: assertion.status });
    case "world_rule":
      return at({ kind: "world_rule", topic: assertion.topic });
    case "lexicon":
      return at({ kind: "lexicon", term: assertion.term, lockedSpelling: assertion.lockedSpelling });
    case "style":
      return at({ kind: "style", field: assertion.field, value: assertion.value });
    case "timeline":
      // Each event lands at its own evidence ordinal (sequence and evidence are
      // positionally aligned), so the global timeline reads in story order and
      // every asserted sequence matches as an ordered subsequence.
      return assertion.sequence.map((event, index) => ({
        ordinal: assertion.evidence[index] ?? assertion.evidence.at(-1) ?? first,
        fact: { kind: "timeline", event } satisfies ExtractedFact,
      }));
  }
}

/** Ordinal → the facts that chapter establishes, folded from every `must`. */
function canonSchedule(
  assertions: readonly Assertion[],
): Map<number, ExtractedFact[]> {
  const schedule = new Map<number, ExtractedFact[]>();
  for (const assertion of assertions) {
    if (assertion.expect !== "must") continue;
    for (const { ordinal, fact } of scheduledFacts(assertion)) {
      const bucket = schedule.get(ordinal) ?? [];
      bucket.push(fact);
      schedule.set(ordinal, bucket);
    }
  }
  return schedule;
}

function canonExtract(schedule: ReadonlyMap<number, ExtractedFact[]>): Extract {
  return async (_text, ordinal, factsSoFar) =>
    (schedule.get(ordinal) ?? []).reduce(applyFact, factsSoFar);
}

/** The fake chapter summary: the facts THAT chapter establishes, rendered
 * through the same fact-text currency the production fake uses — so profiles
 * and the book timeline see real per-ordinal mentions. */
function canonSummary(schedule: ReadonlyMap<number, ExtractedFact[]>): SynthesizeChapterSummary {
  return async ({ ordinal }) => {
    const facts = (schedule.get(ordinal) ?? []).reduce(applyFact, emptyStoryFacts());
    return { ordinal, summary: storyFacts(facts).map((fact) => fact.text).join("; ") };
  };
}

interface TomSawyerRun {
  readonly report: ExtractionAxisReport;
  readonly events: BenchmarkEvent[];
  readonly chapters: readonly ValidatedChapter[];
}

async function runTomSawyer(strategy: SynthesisStrategy, runs: number): Promise<TomSawyerRun> {
  const book = validateBook(bookDir);
  if (!book.ok) throw new Error(`tom-sawyer must validate: ${JSON.stringify(book.errors)}`);
  const assertions = loadAssertionSet(bookDir, { maxOrdinal: maxOrdinal(book.chapters) });
  if (!assertions.ok) throw new Error(`tom-sawyer assertions must validate: ${JSON.stringify(assertions.errors)}`);
  const schedule = canonSchedule(assertions.set.assertions);

  const events: BenchmarkEvent[] = [];
  const report = await runExtractionAxis({
    bookId: "tom-sawyer",
    chapters: book.chapters,
    assertions: assertions.set,
    extract: canonExtract(schedule),
    synthesizeChapterSummary: canonSummary(schedule),
    synthesizeBible: fakeSynthesizeBible,
    synthesis: strategy,
    judge: createStubJudge({ defaultSupported: true }),
    gates: DEFAULT_GATES,
    runs,
    onEvent: (event) => events.push(event),
  });
  return { report, events, chapters: book.chapters };
}

function completedForRun(events: readonly BenchmarkEvent[], runIndex: number): ChapterCompletedEvent[] {
  return events
    .filter((e): e is ChapterCompletedEvent => e.type === "chapter.completed")
    .filter((e) => e.runIndex === runIndex)
    .sort((a, b) => a.ordinal - b.ordinal);
}

function runCompleted(events: readonly BenchmarkEvent[]): RunCompletedEvent {
  const finished = events.find((e) => e.type === "run.completed");
  if (finished?.type !== "run.completed") throw new Error("expected a run.completed event");
  return finished;
}

const isSubset = <T>(smaller: readonly T[], larger: readonly T[]): boolean =>
  smaller.every((entry) => larger.includes(entry));

describe("tom-sawyer end-to-end — offline fakes (issue #21)", () => {
  it("completes green with every kind graded and the location kind passing gates", async () => {
    const { report } = await runTomSawyer("per-section", 3);

    expect(report.passed).toBe(true);
    expect(report.gates.passed).toBe(true);
    expect(report.runs).toBe(3);
    expect(report.kinds).toHaveLength(10);

    // A canon reconstructed from the assertion set satisfies every `must` and
    // trips no `must_not`: perfect, variance-free scores across the protocol.
    for (const entry of report.kinds) {
      expect(entry.report.recall.mean, `${entry.kind} recall`).toBe(1);
      expect(entry.report.precision.mean, `${entry.kind} precision`).toBe(1);
      expect(entry.report.f1.mean, `${entry.kind} f1`).toBe(1);
      expect(entry.report.recall.variance).toBe(0);
    }
    expect(report.globalPrecision.mean).toBe(1);
    expect(report.sweep.estimatedFabricationRate.mean).toBe(0);

    // The new location kind is graded like every other kind (criterion 3).
    const location = report.kinds.find((k) => k.kind === "location");
    expect(location).toBeDefined();
    expect(location?.report.tp.mean).toBe(3);
    expect(location?.report.fn.mean).toBe(0);
    expect(location?.report.fp.mean).toBe(0);
  });

  it("populates every Story Bible section the canon establishes", async () => {
    const { events } = await runTomSawyer("per-section", 1);
    const final = runCompleted(events);
    const bible = final.bible;
    const facts = final.facts;

    expect(facts.characters.length).toBeGreaterThan(0);
    expect(bible.bookOverview.title).not.toBe("");
    expect(bible.bookOverview.premise).not.toBe("");
    expect(bible.bookOverview.synopsis).not.toBe("");

    expect(bible.world.classification).not.toBe("");
    expect(bible.world.description).not.toBe("");
    expect(bible.world.rules.length).toBeGreaterThan(0);

    expect(bible.characterProfiles.map((p) => p.name).sort()).toEqual(
      facts.characters.map((c) => c.name).sort(),
    );
    expect(bible.characterProfiles.length).toBeGreaterThan(0);
    for (const profile of bible.characterProfiles) {
      expect(profile.mentionOrdinals.length).toBeGreaterThan(0);
    }

    // Locations (issue #17): the three canon places, and the negative probe.
    const locationNames = bible.locations.map((l) => l.name);
    expect(locationNames.sort()).toEqual(facts.locations.map((l) => l.name).sort());
    expect(locationNames).toContain("St. Petersburg");
    expect(locationNames).toContain("Jackson\u2019s Island");
    expect(locationNames).toContain("McDougal\u2019s cave");
    expect(locationNames).not.toContain("New Orleans");

    expect(bible.threadRollups.map((t) => t.thread).sort()).toEqual(
      facts.threads.map((t) => t.thread).sort(),
    );
    expect(bible.itemsOfSignificance.map((i) => i.name).sort()).toEqual(
      facts.items.map((i) => i.item).sort(),
    );
    expect(bible.lexiconNotes.map((l) => l.term).sort()).toEqual(
      facts.lexicon.map((l) => l.term).sort(),
    );
    expect(bible.styleRollup.map((s) => s.field).sort()).toEqual(
      facts.style.map((s) => s.field).sort(),
    );
    expect(bible.worldTimeline.map((e) => e.event).sort()).toEqual(
      [...facts.timeline].sort(),
    );

    expect(bible.chapterSummaries).toHaveLength(36);
    expect(bible.graph.nodes.length).toBeGreaterThan(0);
    expect(bible.graph.edges.length).toBe(facts.relationships.length);

    // Groups and open loops have no Story Facts source, so the deterministic
    // fake ships them as valid "none yet" placeholders; the live synthesizer
    // populates them from prose (verified by the live run in docs/TESTING.md).
    expect(Array.isArray(bible.groups)).toBe(true);
    expect(Array.isArray(bible.openLoops)).toBe(true);
  });

  it("versions the bible per ordinal: monotonic growth, never contradicting facts-as-of-N", async () => {
    const { events } = await runTomSawyer("per-section", 1);
    const completed = completedForRun(events, 1);
    expect(completed.map((e) => e.ordinal)).toEqual(
      Array.from({ length: 36 }, (_, i) => i + 1),
    );

    const characterNames = (b: (typeof completed)[number]["bible"]): string[] =>
      b.characterProfiles.map((p) => p.name);
    const locationNames = (b: (typeof completed)[number]["bible"]): string[] =>
      b.locations.map((l) => l.name);
    const threadNames = (b: (typeof completed)[number]["bible"]): string[] =>
      b.threadRollups.map((t) => t.thread);
    const itemNames = (b: (typeof completed)[number]["bible"]): string[] =>
      b.itemsOfSignificance.map((i) => i.name);
    const lexiconTerms = (b: (typeof completed)[number]["bible"]): string[] =>
      b.lexiconNotes.map((l) => l.term);
    const styleFields = (b: (typeof completed)[number]["bible"]): string[] =>
      b.styleRollup.map((s) => s.field);
    const timelineEvents = (b: (typeof completed)[number]["bible"]): string[] =>
      b.worldTimeline.map((e) => e.event);

    for (let index = 0; index < completed.length; index++) {
      const event = completed[index];
      if (event === undefined) continue;
      const { bible, facts, ordinal } = event;

      // The bible-as-of-N carries exactly N chapter summaries.
      expect(bible.chapterSummaries.map((s) => s.ordinal)).toEqual(
        Array.from({ length: ordinal }, (_, i) => i + 1),
      );

      // Never contradicts the established facts-as-of-N.
      expect(characterNames(bible).sort()).toEqual(facts.characters.map((c) => c.name).sort());
      expect(locationNames(bible).sort()).toEqual(facts.locations.map((l) => l.name).sort());
      expect(bible.threadRollups.map((t) => `${t.thread}=${t.status}`).sort()).toEqual(
        facts.threads.map((t) => `${t.thread}=${t.status}`).sort(),
      );
      expect(bible.graph.edges.every((edge) =>
        facts.relationships.some(
          (r) => r.from === edge.from && r.to === edge.to && r.relationType === edge.relation,
        ),
      )).toBe(true);

      // Grows monotonically into the next ordinal.
      const next = completed[index + 1];
      if (next !== undefined) {
        expect(isSubset(characterNames(bible), characterNames(next.bible)), `characters @${ordinal}`).toBe(true);
        expect(isSubset(locationNames(bible), locationNames(next.bible)), `locations @${ordinal}`).toBe(true);
        expect(isSubset(threadNames(bible), threadNames(next.bible)), `threads @${ordinal}`).toBe(true);
        expect(isSubset(itemNames(bible), itemNames(next.bible)), `items @${ordinal}`).toBe(true);
        expect(isSubset(lexiconTerms(bible), lexiconTerms(next.bible)), `lexicon @${ordinal}`).toBe(true);
        expect(isSubset(styleFields(bible), styleFields(next.bible)), `style @${ordinal}`).toBe(true);
        expect(isSubset(timelineEvents(bible), timelineEvents(next.bible)), `timeline @${ordinal}`).toBe(true);
      }
    }
  });

  it("defaults to per-section synthesis and still completes green under monolithic", async () => {
    const perSection = await runTomSawyer("per-section", 1);
    expect(perSection.report.passed).toBe(true);
    for (const event of completedForRun(perSection.events, 1)) {
      expect(event.synthesis).toBe("per-section");
    }
    expect(runCompleted(perSection.events).synthesis).toBe("per-section");

    // The monolithic strategy is accepted end-to-end and produces the same
    // graded, gated result (the deterministic fake ignores the strategy; the
    // live vendor path branches on it — see docs/TESTING.md §9.4 live runs).
    const monolithic = await runTomSawyer("monolithic", 1);
    expect(monolithic.report.passed).toBe(true);
    expect(runCompleted(monolithic.events).synthesis).toBe("monolithic");
    for (const event of completedForRun(monolithic.events, 1)) {
      expect(event.synthesis).toBe("monolithic");
    }
  });
});
