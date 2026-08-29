import {
  ENTITY_KINDS,
  THREAD_STATUSES,
  type BibleState,
  type EntityKind,
  type ThreadStatus,
} from "../lib/bible.js";
import type { Expectation } from "../lib/assertions.js";
import type { ExtractionSnapshot } from "../lib/extraction-run.js";
import type { GateCheck, GateEvaluation } from "../lib/gates.js";
import type { Stats } from "../lib/metrics.js";
import { isPlainObject, nonEmptyString, positiveInt } from "../lib/schema-primitives.js";
import type { ExtractionAxisReport, KindReport, SweepReport } from "./axes/extraction-axis.js";

/**
 * The wire vocabulary re-exported for consumers of the `@writer-os/benchmark/events`
 * subpath: event payload types they annotate against, plus the runtime kind
 * list the Story Bible viewer groups by.
 */
export { ENTITY_KINDS } from "../lib/bible.js";
export { isPlainObject, nonEmptyString, positiveInt } from "../lib/schema-primitives.js";
export { AXES, JUDGES, PIPELINES } from "./types.js";
export type { Axis, JudgeKind, PipelineKind } from "./types.js";
export type { BibleState, EntityKind, ThreadStatus } from "../lib/bible.js";
export type { Expectation } from "../lib/assertions.js";
export type { ExtractionSnapshot } from "../lib/extraction-run.js";
export type { GateCheck, GateEvaluation } from "../lib/gates.js";
export type { Stats } from "../lib/metrics.js";
export type { ExtractionAxisReport, KindReport, SweepReport } from "./axes/extraction-axis.js";

/**
 * The machine-readable `events` output format (issue #11): one JSON event per
 * line on stdout while human progress stays on stderr. This module is the
 * single source of truth for the wire vocabulary — the CLI emits through
 * {@link createEventEmitter}, and any consumer (the benchmark UI's run
 * manager) parses through {@link parseBenchmarkEvent}, which narrows `unknown`
 * into the discriminated union before use (CODING_STANDARDS §1.5).
 */

export interface RunStartedEvent {
  readonly type: "run.started";
  readonly book: string;
  readonly axis: "extraction";
  readonly runs: number;
  /** Chapter count from the fixture manifest — the progress denominator. */
  readonly totalChapters: number;
}

export interface ChapterStartedEvent {
  readonly type: "chapter.started";
  readonly ordinal: number;
  /** 1-based sequential run index. */
  readonly runIndex: number;
}

export interface ChapterCompletedEvent {
  readonly type: "chapter.completed";
  readonly ordinal: number;
  readonly runIndex: number;
  readonly elapsedMs: number;
  readonly canonEntries: number;
  /** The full Story Bible snapshot after this chapter. */
  readonly bible: BibleState;
}

/** One missed (`omission`) or violated (`fabrication`) assertion, per run. */
export interface ExtractionEvidenceLine {
  readonly runIndex: number;
  readonly assertionId: string;
  readonly kind: EntityKind;
  readonly expect: Expectation;
  readonly gradedAtOrdinal: number;
  readonly verdict: "omission" | "fabrication";
}

export interface RunCompletedEvent {
  readonly type: "run.completed";
  readonly exitCode: number;
  readonly report: ExtractionAxisReport;
  /** The final Story Bible — the snapshot after the last chapter of the last run. */
  readonly bible: BibleState;
  /** Every per-ordinal snapshot of the final run ("as of chapter N"). */
  readonly snapshots: readonly ExtractionSnapshot[];
  readonly evidence: readonly ExtractionEvidenceLine[];
}

export interface RunFailedEvent {
  readonly type: "run.failed";
  readonly exitCode: number;
  readonly message: string;
}

export type BenchmarkEvent =
  | RunStartedEvent
  | ChapterStartedEvent
  | ChapterCompletedEvent
  | RunCompletedEvent
  | RunFailedEvent;

export type EventSink = (event: BenchmarkEvent) => void;

export interface BenchmarkEventEmitter {
  emit(event: BenchmarkEvent): void;
  /** True once a terminal event (`run.completed`/`run.failed`) was emitted. */
  readonly finished: boolean;
}

/** Serializes events as NDJSON onto the given stdout line sink. */
export function createEventEmitter(stdout: (line: string) => void): BenchmarkEventEmitter {
  let finished = false;
  return {
    emit(event) {
      if (event.type === "run.completed" || event.type === "run.failed") finished = true;
      stdout(JSON.stringify(event));
    },
    get finished() {
      return finished;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Trust-boundary parsing: unknown → BenchmarkEvent, or null.          */
/* ------------------------------------------------------------------ */

type Parser<T> = (value: unknown) => T | null;

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeInt(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function oneOf<T extends string>(allowed: readonly T[]): Parser<T> {
  return (value) => ((allowed as readonly string[]).includes(value as string) ? (value as T) : null);
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  return isPlainObject(value) ? value : null;
}

function required<T>(record: Record<string, unknown>, key: string, parse: Parser<T>): T | null {
  return parse(record[key]);
}

function parseArray<T>(value: unknown, item: Parser<T>): T[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: T[] = [];
  for (const entry of value) {
    const element = item(entry);
    if (element === null) return null;
    parsed.push(element);
  }
  return parsed;
}

const parseString: Parser<string> = (value) => (typeof value === "string" ? value : null);
const parseNonEmptyString: Parser<string> = (value) => (nonEmptyString(value) ? value : null);
const parseBoolean: Parser<boolean> = (value) => (typeof value === "boolean" ? value : null);
const parseFiniteNumber: Parser<number> = (value) => (finiteNumber(value) ? value : null);
const parsePositiveInt: Parser<number> = (value) => (positiveInt(value) ? value : null);
const parseNonNegativeInt: Parser<number> = (value) => (nonNegativeInt(value) ? value : null);

function recordWith<T>(build: (record: Record<string, unknown>) => T | null): Parser<T> {
  return (value) => {
    const record = parseRecord(value);
    return record === null ? null : build(record);
  };
}

const parseStats: Parser<Stats> = recordWith((r) => {
  const mean = required(r, "mean", parseFiniteNumber);
  const variance = required(r, "variance", parseFiniteNumber);
  return mean !== null && variance !== null ? { mean, variance } : null;
});

const parseEntityKind: Parser<EntityKind> = oneOf(ENTITY_KINDS);
const parseThreadStatus: Parser<ThreadStatus> = oneOf(THREAD_STATUSES);
const parseExpectation: Parser<Expectation> = oneOf(["must", "must_not"] as const);

const parseCharacter: Parser<BibleState["characters"][number]> = recordWith((r) => {
  const name = required(r, "name", parseNonEmptyString);
  return name !== null ? { name } : null;
});

const parseAppearance: Parser<BibleState["appearances"][number]> = recordWith((r) => {
  const character = required(r, "character", parseString);
  const attribute = required(r, "attribute", parseString);
  const contains = required(r, "contains", parseString);
  return character !== null && attribute !== null && contains !== null
    ? { character, attribute, contains }
    : null;
});

const parseRelationship: Parser<BibleState["relationships"][number]> = recordWith((r) => {
  const from = required(r, "from", parseString);
  const to = required(r, "to", parseString);
  const relationType = required(r, "relationType", parseString);
  return from !== null && to !== null && relationType !== null ? { from, to, relationType } : null;
});

const parseItem: Parser<BibleState["items"][number]> = recordWith((r) => {
  const item = required(r, "item", parseString);
  const holder = required(r, "holder", parseString);
  return item !== null && holder !== null ? { item, holder } : null;
});

const parseThread: Parser<BibleState["threads"][number]> = recordWith((r) => {
  const thread = required(r, "thread", parseString);
  const status = required(r, "status", parseThreadStatus);
  return thread !== null && status !== null ? { thread, status } : null;
});

const parseWorldRule: Parser<BibleState["worldRules"][number]> = recordWith((r) => {
  const topic = required(r, "topic", parseString);
  return topic !== null ? { topic } : null;
});

const parseLexicon: Parser<BibleState["lexicon"][number]> = recordWith((r) => {
  const term = required(r, "term", parseString);
  const lockedSpelling = required(r, "lockedSpelling", parseBoolean);
  return term !== null && lockedSpelling !== null ? { term, lockedSpelling } : null;
});

const parseStyle: Parser<BibleState["style"][number]> = recordWith((r) => {
  const field = required(r, "field", parseString);
  const value = required(r, "value", parseString);
  return field !== null && value !== null ? { field, value } : null;
});

export const parseBibleState: Parser<BibleState> = recordWith((r) => {
  const characters = required(r, "characters", (v) => parseArray(v, parseCharacter));
  const appearances = required(r, "appearances", (v) => parseArray(v, parseAppearance));
  const relationships = required(r, "relationships", (v) => parseArray(v, parseRelationship));
  const items = required(r, "items", (v) => parseArray(v, parseItem));
  const threads = required(r, "threads", (v) => parseArray(v, parseThread));
  const worldRules = required(r, "worldRules", (v) => parseArray(v, parseWorldRule));
  const timeline = required(r, "timeline", (v) => parseArray(v, parseString));
  const lexicon = required(r, "lexicon", (v) => parseArray(v, parseLexicon));
  const style = required(r, "style", (v) => parseArray(v, parseStyle));
  if (
    characters === null ||
    appearances === null ||
    relationships === null ||
    items === null ||
    threads === null ||
    worldRules === null ||
    timeline === null ||
    lexicon === null ||
    style === null
  ) {
    return null;
  }
  return { characters, appearances, relationships, items, threads, worldRules, timeline, lexicon, style };
});

const parseSnapshot: Parser<ExtractionSnapshot> = recordWith((r) => {
  const afterOrdinal = required(r, "afterOrdinal", parsePositiveInt);
  const bible = required(r, "bible", parseBibleState);
  return afterOrdinal !== null && bible !== null ? { afterOrdinal, bible } : null;
});

const parseKindReport: Parser<KindReport> = recordWith((r) => {
  const precision = required(r, "precision", parseStats);
  const recall = required(r, "recall", parseStats);
  const f1 = required(r, "f1", parseStats);
  const tp = required(r, "tp", parseStats);
  const fp = required(r, "fp", parseStats);
  const fn = required(r, "fn", parseStats);
  return precision !== null && recall !== null && f1 !== null && tp !== null && fp !== null && fn !== null
    ? { precision, recall, f1, tp, fp, fn }
    : null;
});

const parseKindEntry = recordWith<{
  readonly kind: EntityKind;
  readonly report: KindReport;
}>((r) => {
  const kind = required(r, "kind", parseEntityKind);
  const report = required(r, "report", parseKindReport);
  return kind !== null && report !== null ? { kind, report } : null;
});

const parseGateCheck: Parser<GateCheck> = recordWith((r) => {
  const gate = required(r, "gate", parseNonEmptyString);
  const value = required(r, "value", parseFiniteNumber);
  const floor = required(r, "floor", parseFiniteNumber);
  const passed = required(r, "passed", parseBoolean);
  return gate !== null && value !== null && floor !== null && passed !== null
    ? { gate, value, floor, passed }
    : null;
});

const parseGateEvaluation: Parser<GateEvaluation> = recordWith((r) => {
  const checks = required(r, "checks", (v) => parseArray(v, parseGateCheck));
  const passed = required(r, "passed", parseBoolean);
  return checks !== null && passed !== null ? { checks, passed } : null;
});

const parseSweepReport: Parser<SweepReport> = recordWith((r) => {
  const swept = required(r, "swept", parseStats);
  const unsupported = required(r, "unsupported", parseStats);
  const estimatedFabricationRate = required(r, "estimatedFabricationRate", parseStats);
  return swept !== null && unsupported !== null && estimatedFabricationRate !== null
    ? { swept, unsupported, estimatedFabricationRate }
    : null;
});

const parseAxisReport: Parser<ExtractionAxisReport> = recordWith((r) => {
  const book = required(r, "book", parseNonEmptyString);
  const axis = required(r, "axis", oneOf(["extraction"] as const));
  const runs = required(r, "runs", parsePositiveInt);
  const kinds = required(r, "kinds", (v) => parseArray(v, parseKindEntry));
  const globalPrecision = required(r, "globalPrecision", parseStats);
  const sweep = required(r, "sweep", parseSweepReport);
  const gates = required(r, "gates", parseGateEvaluation);
  const passed = required(r, "passed", parseBoolean);
  if (
    book === null ||
    axis === null ||
    runs === null ||
    kinds === null ||
    globalPrecision === null ||
    sweep === null ||
    gates === null ||
    passed === null
  ) {
    return null;
  }
  return { book, axis, runs, kinds, globalPrecision, sweep, gates, passed };
});

const parseEvidenceLine: Parser<ExtractionEvidenceLine> = recordWith((r) => {
  const runIndex = required(r, "runIndex", parsePositiveInt);
  const assertionId = required(r, "assertionId", parseNonEmptyString);
  const kind = required(r, "kind", parseEntityKind);
  const expect = required(r, "expect", parseExpectation);
  const gradedAtOrdinal = required(r, "gradedAtOrdinal", parsePositiveInt);
  const verdict = required(r, "verdict", oneOf(["omission", "fabrication"] as const));
  return runIndex !== null &&
    assertionId !== null &&
    kind !== null &&
    expect !== null &&
    gradedAtOrdinal !== null &&
    verdict !== null
    ? { runIndex, assertionId, kind, expect, gradedAtOrdinal, verdict }
    : null;
});

/** Narrows one parsed JSON value from a child process into a known event. */
export function parseBenchmarkEvent(value: unknown): BenchmarkEvent | null {
  const record = parseRecord(value);
  if (record === null) return null;
  const type = record["type"];

  switch (type) {
    case "run.started": {
      const book = required(record, "book", parseNonEmptyString);
      const axis = required(record, "axis", oneOf(["extraction"] as const));
      const runs = required(record, "runs", parsePositiveInt);
      const totalChapters = required(record, "totalChapters", parsePositiveInt);
      return book !== null && axis !== null && runs !== null && totalChapters !== null
        ? { type, book, axis, runs, totalChapters }
        : null;
    }
    case "chapter.started": {
      const ordinal = required(record, "ordinal", parsePositiveInt);
      const runIndex = required(record, "runIndex", parsePositiveInt);
      return ordinal !== null && runIndex !== null ? { type, ordinal, runIndex } : null;
    }
    case "chapter.completed": {
      const ordinal = required(record, "ordinal", parsePositiveInt);
      const runIndex = required(record, "runIndex", parsePositiveInt);
      const elapsedMs = required(record, "elapsedMs", parseNonNegativeInt);
      const canonEntries = required(record, "canonEntries", parseNonNegativeInt);
      const bible = required(record, "bible", parseBibleState);
      return ordinal !== null && runIndex !== null && elapsedMs !== null && canonEntries !== null && bible !== null
        ? { type, ordinal, runIndex, elapsedMs, canonEntries, bible }
        : null;
    }
    case "run.completed": {
      const exitCode = required(record, "exitCode", parseNonNegativeInt);
      const report = required(record, "report", parseAxisReport);
      const bible = required(record, "bible", parseBibleState);
      const snapshots = required(record, "snapshots", (v) => parseArray(v, parseSnapshot));
      const evidence = required(record, "evidence", (v) => parseArray(v, parseEvidenceLine));
      return exitCode !== null && report !== null && bible !== null && snapshots !== null && evidence !== null
        ? { type, exitCode, report, bible, snapshots, evidence }
        : null;
    }
    case "run.failed": {
      const exitCode = required(record, "exitCode", parseNonNegativeInt);
      const message = required(record, "message", parseNonEmptyString);
      return exitCode !== null && message !== null ? { type, exitCode, message } : null;
    }
    default:
      return null;
  }
}
