import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EXIT_GATE_FAILED,
  EXIT_OK,
  EXIT_USAGE,
  EXIT_VALIDATION_FAILED,
  runCli,
  type CliIo,
} from "./index.js";
import { parseBenchmarkEvent, type BenchmarkEvent } from "./events.js";

/**
 * The NDJSON `events` format (issue #11): one JSON event per line on stdout,
 * human progress on stderr. These tests drive the CLI engine with captured io
 * exactly like engine.test.ts and pin the deterministic mini-book event
 * sequence — the fixture's ground truth is known by construction, so the
 * sequence doubles as the correctness proof for the seam.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bench-events-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const REPO_BOOKS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "books");

function installMiniBook(): void {
  cpSync(join(REPO_BOOKS, "mini-book"), join(root, "mini-book"), { recursive: true });
}

interface Output {
  out: string[];
  err: string[];
}

function capture(): CliIo & Output {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    out,
    err,
  };
}

function run(
  argv: string[],
  io: CliIo & Output,
  env: Record<string, string> = {},
): Promise<number> {
  const fullArgv = argv.includes("--pipeline") ? argv : [...argv, "--pipeline", "fake"];
  delete process.env.AGNES_API_KEY;
  Object.assign(process.env, env);
  return runCli(fullArgv, io, {
    booksRoot: root,
    judgeCachePath: join(root, "cache.json"),
    extractCachePath: join(root, "extract-cache.json"),
  });
}

/** Every stdout line must be a valid event — the stream's purity is the contract. */
function eventsFrom(out: string[]): BenchmarkEvent[] {
  return out.map((line) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`stdout line is not JSON: ${line}`);
    }
    const event = parseBenchmarkEvent(raw);
    if (event === null) {
      throw new Error(`stdout line is not a valid benchmark event: ${line}`);
    }
    return event;
  });
}

function expectType<T extends BenchmarkEvent["type"]>(
  events: readonly BenchmarkEvent[],
  index: number,
  type: T,
): Extract<BenchmarkEvent, { type: T }> {
  const event = events[index];
  if (event === undefined || event.type !== type) {
    throw new Error(`expected event ${index} to be "${type}", got ${JSON.stringify(event)}`);
  }
  // The runtime discriminant check above proves the narrowing; TS cannot
  // correlate a generic literal with a union discriminant, so the cast is
  // the checker being told what the guard already established.
  return event as Extract<BenchmarkEvent, { type: T }>;
}

describe("--format events — deterministic mini-book sequence (fake pipeline, stub judge)", () => {
  it("emits run.started, four chapter pairs, then run.completed for one run", async () => {
    installMiniBook();
    const io = capture();

    await expect(
      run(["run", "--book", "mini-book", "--axis", "extraction", "--runs", "1", "--format", "events"], io),
    ).resolves.toBe(EXIT_OK);

    const events = eventsFrom(io.out);
    expect(events.map((e) => e.type)).toEqual([
      "run.started",
      "chapter.started",
      "chapter.completed",
      "chapter.started",
      "chapter.completed",
      "chapter.started",
      "chapter.completed",
      "chapter.started",
      "chapter.completed",
      "run.completed",
    ]);

    const started = expectType(events, 0, "run.started");
    expect(started.book).toBe("mini-book");
    expect(started.axis).toBe("extraction");
    expect(started.runs).toBe(1);
    expect(started.totalChapters).toBe(4);

    const completed = expectType(events, 9, "run.completed");
    expect(completed.exitCode).toBe(EXIT_OK);
    expect(completed.report.passed).toBe(true);
    expect(completed.report.runs).toBe(1);
    expect(completed.evidence).toEqual([]);
  });

  it("carries per-chapter timing, growing Canon entry counts, and full facts snapshots", async () => {
    installMiniBook();
    const io = capture();
    await run(
      ["run", "--book", "mini-book", "--axis", "extraction", "--runs", "1", "--format", "events"],
      io,
    );
    const events = eventsFrom(io.out);

    const chapterEvents = events.filter(
      (e): e is Extract<BenchmarkEvent, { type: "chapter.started" | "chapter.completed" }> =>
        e.type === "chapter.started" || e.type === "chapter.completed",
    );
    expect(chapterEvents.map((e) => e.ordinal)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(chapterEvents.filter((e) => e.type === "chapter.started").every((e) => e.runIndex === 1)).toBe(
      true,
    );

    // Canon accumulation per ordinal is hand-computable from the fake grammar:
    // ch1 7 entries, ch2 +3, ch3 +2, ch4 +1 (holder/status replace in place).
    const completedChapters = events.filter(
      (e): e is Extract<BenchmarkEvent, { type: "chapter.completed" }> =>
        e.type === "chapter.completed",
    );
    expect(completedChapters.map((e) => e.canonEntries)).toEqual([7, 10, 12, 13]);
    for (const chapter of completedChapters) {
      expect(chapter.elapsedMs).toBeTypeOf("number");
      expect(chapter.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(typeof chapter.chapterSummary).toBe("string");
      expect(chapter.synthesis).toBe("per-section");
      // The bible through each ordinal carries that chapter's summary.
      expect(chapter.bible.chapterSummaries.at(-1)).toEqual({
        ordinal: chapter.ordinal,
        summary: chapter.chapterSummary,
      });
    }
    // The ch1 summary renders the newly graded location fact.
    expect(completedChapters[0]?.chapterSummary).toContain('location named "the northern light"');
    expect(completedChapters[1]?.facts.items).toEqual([{ item: "brass compass", holder: "Mara Vey" }]);
    expect(completedChapters[3]?.facts.items).toEqual([
      { item: "brass compass", holder: "Joren Vey" },
    ]);
  });

  it("run.completed carries the report, the final Story Facts, and every per-ordinal snapshot", async () => {
    installMiniBook();
    const io = capture();
    await run(
      ["run", "--book", "mini-book", "--axis", "extraction", "--runs", "1", "--format", "events"],
      io,
    );
    const completed = expectType(eventsFrom(io.out), 9, "run.completed");

    const facts = completed.facts;
    expect(facts.characters.map((c) => c.name)).toEqual(["Mara Vey", "Joren Vey"]);
    expect(facts.appearances).toEqual([
      { character: "Mara Vey", attribute: "her coat", contains: "salt-white wool" },
    ]);
    expect(facts.relationships).toEqual([
      { from: "Mara Vey", to: "Joren Vey", relationType: "daughter" },
      { from: "Joren Vey", to: "Mara Vey", relationType: "father" },
    ]);
    expect(facts.items).toEqual([{ item: "brass compass", holder: "Joren Vey" }]);
    expect(facts.threads).toEqual([{ thread: "the missing ledger", status: "resolved" }]);
    expect(facts.worldRules).toEqual([{ topic: "the northern light burns without oil" }]);
    expect(facts.timeline).toEqual(["the harbor bell rang", "the ledger burned"]);
    expect(facts.lexicon).toEqual([{ term: "Vess", lockedSpelling: true }]);
    expect(facts.style).toEqual([{ field: "narration", value: "close third person, past tense" }]);

    expect(completed.snapshots.map((s) => s.afterOrdinal)).toEqual([1, 2, 3, 4]);
    expect(completed.snapshots[0]?.facts.characters).toHaveLength(2);
    expect(completed.snapshots[1]?.facts.threads).toEqual([
      { thread: "the missing ledger", status: "open" },
    ]);

    // The synthesis layer rides alongside the fact snapshots (issue #14).
    expect(completed.synthesis).toBe("per-section");
    expect(completed.bibleSnapshots.map((s) => s.afterOrdinal)).toEqual([1, 2, 3, 4]);
    expect(completed.bible).toEqual(completed.bibleSnapshots.at(-1)?.bible);
    expect(completed.bible.chapterSummaries).toHaveLength(4);
    expect(completed.bible.graph.nodes).toEqual([
      { name: "Mara Vey", importance: 5, role: "protagonist" },
      { name: "Joren Vey", importance: 4, role: "supporting" },
    ]);
  });

  it("repeats the chapter cycle per run with 1-based runIndex", async () => {
    installMiniBook();
    const io = capture();
    await run(
      ["run", "--book", "mini-book", "--axis", "extraction", "--runs", "2", "--format", "events"],
      io,
    );
    const events = eventsFrom(io.out);

    const chapters = events.filter(
      (e): e is Extract<BenchmarkEvent, { type: "chapter.completed" }> =>
        e.type === "chapter.completed",
    );
    expect(chapters).toHaveLength(8);
    expect(chapters.map((e) => e.runIndex)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    expect(chapters.map((e) => e.ordinal)).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);

    const completed = expectType(events, events.length - 1, "run.completed");
    expect(completed.report.runs).toBe(2);
  });

  it("keeps stdout pure NDJSON and moves human chatter to stderr", async () => {
    installMiniBook();
    const io = capture();
    await run(
      ["run", "--book", "mini-book", "--axis", "extraction", "--runs", "1", "--format", "events"],
      io,
    );

    for (const line of io.out) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    const err = io.err.join("\n");
    expect(err).toContain("cache: ENABLED");
    expect(err).toContain("extraction axis: mini-book");
  });

  it("surfaces a gate failure as run.completed with exit code 4 and omission evidence", async () => {
    installMiniBook();
    const ch02 = join(root, "mini-book", "source", "ch02.txt");
    writeFileSync(
      ch02,
      readFileSync(ch02, "utf8")
        .split("\n")
        .filter((line) => !line.startsWith('Say always "Vess"'))
        .join("\n"),
    );
    const gatesPath = join(root, "gates.json");
    writeFileSync(gatesPath, JSON.stringify({ recall_min: { lexicon: 0.9 } }));

    const io = capture();
    await expect(
      run(
        [
          "run",
          "--book",
          "mini-book",
          "--axis",
          "extraction",
          "--runs",
          "1",
          "--gates",
          gatesPath,
          "--format",
          "events",
        ],
        io,
      ),
    ).resolves.toBe(EXIT_GATE_FAILED);

    const events = eventsFrom(io.out);
    const completed = expectType(events, events.length - 1, "run.completed");
    expect(completed.exitCode).toBe(EXIT_GATE_FAILED);
    expect(completed.report.passed).toBe(false);
    expect(completed.evidence).toEqual([
      {
        runIndex: 1,
        assertionId: "lex-vess-locked",
        kind: "lexicon",
        expect: "must",
        gradedAtOrdinal: 4,
        verdict: "omission",
      },
    ]);
  });

  it("emits run.failed when fixture validation fails before any chapter runs", async () => {
    installMiniBook();
    rmSync(join(root, "mini-book", "source", "ch02.txt"));
    const io = capture();

    await expect(
      run(["run", "--book", "mini-book", "--axis", "extraction", "--format", "events"], io),
    ).resolves.toBe(EXIT_VALIDATION_FAILED);

    const events = eventsFrom(io.out);
    expect(events).toHaveLength(1);
    const failed = expectType(events, 0, "run.failed");
    expect(failed.exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(failed.message).toContain("mini-book");
    expect(io.err.join("\n")).toContain("E_FILE_MISSING");
  });

  it("emits run.failed instead of crashing when the axis throws mid-run", async () => {
    installMiniBook();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("connection error: no network in tests");
    };
    const io = capture();
    try {
      await expect(
        run(
          ["run", "--book", "mini-book", "--axis", "extraction", "--judge", "live", "--format", "events"],
          io,
          { AGNES_API_KEY: "test-key" },
        ),
      ).resolves.toBe(EXIT_VALIDATION_FAILED);
    } finally {
      globalThis.fetch = originalFetch;
    }

    const events = eventsFrom(io.out);
    const failed = expectType(events, events.length - 1, "run.failed");
    expect(failed.exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(failed.message).toMatch(/connection error/i);
  });

  it("rejects the events format on non-extraction axes as a usage error", async () => {
    installMiniBook();
    const io = capture();
    await expect(
      run(["run", "--book", "mini-book", "--axis", "checker", "--format", "events"], io),
    ).resolves.toBe(EXIT_USAGE);
    expect(io.err.join("\n")).toContain("events");
  });
});

describe("text and json formats are unchanged by the events seam", () => {
  it("text stdout carries the human report and cache announcement, no events", async () => {
    installMiniBook();
    const io = capture();
    await run(["run", "--book", "mini-book", "--axis", "extraction", "--runs", "1"], io);

    const text = io.out.join("\n");
    expect(text).toContain("cache: ENABLED");
    expect(text).toContain("extraction — mini-book (runs: 1)");
    expect(text).toContain("gates: PASS");
    expect(text).not.toContain('"type"');
  });

  it("json stdout stays a single pure JSON report", async () => {
    installMiniBook();
    const io = capture();
    await run(
      ["run", "--book", "mini-book", "--axis", "extraction", "--runs", "1", "--format", "json"],
      io,
    );

    const parsed = JSON.parse(io.out.join("\n")) as { passed: boolean; runs: number };
    expect(parsed.passed).toBe(true);
    expect(parsed.runs).toBe(1);
  });
});

describe("parseBenchmarkEvent — the child-process trust boundary", () => {
  const validRunStarted = {
    type: "run.started",
    book: "mini-book",
    axis: "extraction",
    runs: 1,
    totalChapters: 4,
  };

  const emptyBible = {
    bookOverview: "",
    world: { classification: "earth", description: "", rules: [] },
    characterProfiles: [],
    locations: [],
    threadRollups: [],
    groups: [],
    itemsOfSignificance: [],
    lexiconNotes: [],
    openLoops: [],
    styleRollup: [],
    worldTimeline: [],
    bookTimeline: [],
    chapterSummaries: [{ ordinal: 1, summary: "Mara keeps the light." }],
    graph: {
      nodes: [{ name: "Mara Vey", importance: 1, role: "protagonist" }],
      edges: [],
    },
  };

  it("accepts a well-formed run.started", () => {
    expect(parseBenchmarkEvent(validRunStarted)).toEqual(validRunStarted);
  });

  it("rejects non-objects and unknown discriminants", () => {
    expect(parseBenchmarkEvent(null)).toBeNull();
    expect(parseBenchmarkEvent("run.started")).toBeNull();
    expect(parseBenchmarkEvent({ type: "chapter.skipped" })).toBeNull();
    expect(parseBenchmarkEvent({})).toBeNull();
  });

  it("rejects run.started with missing or mistyped fields", () => {
    expect(parseBenchmarkEvent({ ...validRunStarted, book: "" })).toBeNull();
    expect(parseBenchmarkEvent({ ...validRunStarted, axis: "checker" })).toBeNull();
    expect(parseBenchmarkEvent({ ...validRunStarted, runs: 0 })).toBeNull();
    expect(parseBenchmarkEvent({ ...validRunStarted, runs: 1.5 })).toBeNull();
    expect(parseBenchmarkEvent({ ...validRunStarted, totalChapters: "4" })).toBeNull();
    const { totalChapters: _missing, ...withoutTotal } = validRunStarted;
    expect(parseBenchmarkEvent(withoutTotal)).toBeNull();
  });

  it("rejects chapter events with invalid ordinals, timings, or facts payloads", () => {
    expect(
      parseBenchmarkEvent({ type: "chapter.started", ordinal: 0, runIndex: 1 }),
    ).toBeNull();
    expect(
      parseBenchmarkEvent({ type: "chapter.started", ordinal: 1, runIndex: -1 }),
    ).toBeNull();
    const chapterCompleted = {
      type: "chapter.completed",
      ordinal: 1,
      runIndex: 1,
      elapsedMs: 5,
      canonEntries: 6,
      facts: {
        characters: [{ name: "Mara Vey" }],
        appearances: [],
        relationships: [],
        items: [],
        locations: [{ name: "the northern light" }],
        threads: [],
        worldRules: [],
        timeline: [],
        lexicon: [],
        style: [],
      },
      chapterSummary: 'location named "the northern light"',
      bible: emptyBible,
      synthesis: "per-section",
    };
    expect(parseBenchmarkEvent(chapterCompleted)?.type).toBe("chapter.completed");
    expect(parseBenchmarkEvent({ ...chapterCompleted, elapsedMs: -1 })).toBeNull();
    expect(parseBenchmarkEvent({ ...chapterCompleted, facts: { ...chapterCompleted.facts, threads: "open" } })).toBeNull();
    expect(
      parseBenchmarkEvent({
        ...chapterCompleted,
        facts: { ...chapterCompleted.facts, threads: [{ thread: "x", status: "cancelled" }] },
      }),
    ).toBeNull();
    const { locations: _missing, ...factsWithoutLocations } = chapterCompleted.facts;
    expect(parseBenchmarkEvent({ ...chapterCompleted, facts: factsWithoutLocations })).toBeNull();
    expect(
      parseBenchmarkEvent({
        ...chapterCompleted,
        facts: { ...chapterCompleted.facts, locations: [{ names: "the northern light" }] },
      }),
    ).toBeNull();
    expect(
      parseBenchmarkEvent({
        ...chapterCompleted,
        facts: { ...chapterCompleted.facts, locations: [{ name: "" }] },
      }),
    ).toBeNull();
    // Synthesis payloads are required and strict.
    const { chapterSummary: _noSummary, ...withoutSummary } = chapterCompleted;
    expect(parseBenchmarkEvent(withoutSummary)).toBeNull();
    expect(parseBenchmarkEvent({ ...chapterCompleted, chapterSummary: 7 })).toBeNull();
    expect(parseBenchmarkEvent({ ...chapterCompleted, synthesis: "holographic" })).toBeNull();
    const { bible: _noBible, ...withoutBible } = chapterCompleted;
    expect(parseBenchmarkEvent(withoutBible)).toBeNull();
    const { graph: _noGraph, ...bibleWithoutGraph } = emptyBible;
    expect(parseBenchmarkEvent({ ...chapterCompleted, bible: bibleWithoutGraph })).toBeNull();
    expect(
      parseBenchmarkEvent({
        ...chapterCompleted,
        bible: { ...emptyBible, chapterSummaries: [{ ordinal: 0, summary: "x" }] },
      }),
    ).toBeNull();
    expect(
      parseBenchmarkEvent({
        ...chapterCompleted,
        bible: { ...emptyBible, graph: { nodes: [{ name: "A", importance: -1, role: "protagonist" }], edges: [] } },
      }),
    ).toBeNull();
  });

  it("rejects run.completed with a malformed report or evidence", () => {
    const base = {
      type: "run.completed",
      exitCode: 0,
      report: {
        book: "mini-book",
        axis: "extraction",
        runs: 1,
        kinds: [],
        globalPrecision: { mean: 1, variance: 0 },
        sweep: {
          swept: { mean: 1, variance: 0 },
          unsupported: { mean: 0, variance: 0 },
          estimatedFabricationRate: { mean: 0, variance: 0 },
        },
        gates: { checks: [], passed: true },
        passed: true,
      },
      facts: {
        characters: [],
        appearances: [],
        relationships: [],
        items: [],
        locations: [],
        threads: [],
        worldRules: [],
        timeline: [],
        lexicon: [],
        style: [],
      },
      snapshots: [],
      evidence: [],
      bible: emptyBible,
      bibleSnapshots: [{ afterOrdinal: 1, bible: emptyBible }],
      synthesis: "per-section",
    };
    expect(parseBenchmarkEvent(base)?.type).toBe("run.completed");
    expect(parseBenchmarkEvent({ ...base, exitCode: "0" })).toBeNull();
    expect(parseBenchmarkEvent({ ...base, report: { ...base.report, passed: "yes" } })).toBeNull();
    expect(
      parseBenchmarkEvent({
        ...base,
        evidence: [{ runIndex: 1, assertionId: "a", kind: "lexicon", expect: "must", gradedAtOrdinal: 2, verdict: "wrong" }],
      }),
    ).toBeNull();
    const { bibleSnapshots: _none, ...withoutBibleSnapshots } = base;
    expect(parseBenchmarkEvent(withoutBibleSnapshots)).toBeNull();
    expect(parseBenchmarkEvent({ ...base, bibleSnapshots: [{ afterOrdinal: 0, bible: emptyBible }] })).toBeNull();
    expect(parseBenchmarkEvent({ ...base, synthesis: "monolith" })).toBeNull();
  });

  const maraProfile = {
    name: "Mara Vey",
    appearance: "her coat: salt-white wool.",
    personality: "steady, watchful",
    definingTraits: ["keeper's resolve"],
    background: "raised in the light",
    arc: "keeper's daughter to keeper",
    firstAppearanceOrdinal: 1,
    mentionOrdinals: [1, 2, 4],
    relationships: [{ other: "Joren Vey", summary: "Mara Vey is the daughter of Joren Vey." }],
  };

  const chapterWithProfiles = {
    type: "chapter.completed",
    ordinal: 4,
    runIndex: 1,
    elapsedMs: 5,
    canonEntries: 6,
    facts: {
      characters: [{ name: "Mara Vey" }, { name: "Joren Vey" }],
      appearances: [],
      relationships: [],
      items: [],
      locations: [],
      threads: [],
      worldRules: [],
      timeline: [],
      lexicon: [],
      style: [],
    },
    chapterSummary: '"Joren Vey" is the "father" of "Mara Vey"',
    bible: { ...emptyBible, characterProfiles: [maraProfile] },
    synthesis: "per-section",
  };

  it("parses a bible carrying rich character profiles field-strictly", () => {
    expect(parseBenchmarkEvent(chapterWithProfiles)?.type).toBe("chapter.completed");

    // Every profile field is required and strictly typed — the parser is the
    // child-process trust boundary for exactly the shape the validator emits.
    for (const field of [
      "name",
      "appearance",
      "personality",
      "definingTraits",
      "background",
      "arc",
      "firstAppearanceOrdinal",
      "mentionOrdinals",
      "relationships",
    ] as const) {
      const without: Record<string, unknown> = { ...maraProfile };
      delete without[field];
      expect(
        parseBenchmarkEvent({
          ...chapterWithProfiles,
          bible: { ...emptyBible, characterProfiles: [without] },
        }),
        `missing "${field}" must be rejected`,
      ).toBeNull();
    }
    expect(
      parseBenchmarkEvent({
        ...chapterWithProfiles,
        bible: { ...emptyBible, characterProfiles: [{ ...maraProfile, name: "" }] },
      }),
    ).toBeNull();
    expect(
      parseBenchmarkEvent({
        ...chapterWithProfiles,
        bible: { ...emptyBible, characterProfiles: [{ ...maraProfile, mentionOrdinals: [0, 1] }] },
      }),
    ).toBeNull();
    expect(
      parseBenchmarkEvent({
        ...chapterWithProfiles,
        bible: { ...emptyBible, characterProfiles: [{ ...maraProfile, mentionOrdinals: "1,2" }] },
      }),
    ).toBeNull();
    expect(
      parseBenchmarkEvent({
        ...chapterWithProfiles,
        bible: { ...emptyBible, characterProfiles: [{ ...maraProfile, firstAppearanceOrdinal: 0 }] },
      }),
    ).toBeNull();
    expect(
      parseBenchmarkEvent({
        ...chapterWithProfiles,
        bible: { ...emptyBible, characterProfiles: [{ ...maraProfile, definingTraits: [42] }] },
      }),
    ).toBeNull();
    expect(
      parseBenchmarkEvent({
        ...chapterWithProfiles,
        bible: { ...emptyBible, characterProfiles: [{ ...maraProfile, relationships: "daughter" }] },
      }),
    ).toBeNull();
    expect(
      parseBenchmarkEvent({
        ...chapterWithProfiles,
        bible: {
          ...emptyBible,
          characterProfiles: [{ ...maraProfile, relationships: [{ other: "Joren Vey" }] }],
        },
      }),
    ).toBeNull();
    expect(
      parseBenchmarkEvent({
        ...chapterWithProfiles,
        bible: {
          ...emptyBible,
          characterProfiles: [{ ...maraProfile, relationships: [{ other: "", summary: "x" }] }],
        },
      }),
    ).toBeNull();
  });

  it("parses location profiles with the grounded charactersSeen shape (issue #17)", () => {
    const located = {
      ...chapterWithProfiles,
      bible: {
        ...emptyBible,
        locations: [
          {
            name: "the northern light",
            description: "A lighthouse.",
            significance: "Anchors the keeper's daily round.",
            charactersSeen: [{ character: "Mara Vey", firstCoOccurrenceOrdinal: 1 }],
          },
        ],
      },
    };
    expect(parseBenchmarkEvent(located)?.type).toBe("chapter.completed");
    expect(
      parseBenchmarkEvent({
        ...located,
        bible: { ...emptyBible, locations: [{ name: "the northern light" }] },
      }),
    ).toBeNull();
    expect(
      parseBenchmarkEvent({
        ...located,
        bible: {
          ...emptyBible,
          locations: [
            {
              name: "the northern light",
              description: "A lighthouse.",
              significance: "Anchors the keeper's daily round.",
              charactersSeen: [{ character: "Mara Vey" }],
            },
          ],
        },
      }),
    ).toBeNull();
  });

  it("accepts a full round-trip of the emitted mini-book stream", async () => {
    installMiniBook();
    const io = capture();
    await run(
      ["run", "--book", "mini-book", "--axis", "extraction", "--runs", "1", "--format", "events"],
      io,
    );
    const reparsed = io.out.map((line) => parseBenchmarkEvent(JSON.parse(line)));
    expect(reparsed.every((e) => e !== null)).toBe(true);
    expect(reparsed[0]?.type).toBe("run.started");
  });
});
