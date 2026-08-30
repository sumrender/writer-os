import {
  ENTITY_KINDS,
  THREAD_STATUSES,
  type StoryFacts,
  type EntityKind,
  type ThreadStatus,
} from "../lib/story-facts.js";
import type { Expectation } from "../lib/assertions.js";
import type { ExtractionSnapshot } from "../lib/extraction-run.js";
import type { GateCheck, GateEvaluation } from "../lib/gates.js";
import type { Stats } from "../lib/metrics.js";
import type {
  BibleSnapshot,
  ChapterSummaryEntry,
  CharacterProfile,
  CharacterRelationship,
  GraphData,
  LocationCharacterSeen,
  LocationProfile,
  StoryBible,
  WorldClassification,
  WorldRule,
  WorldRuleRelation,
  WorldSection,
} from "../lib/story-bible.js";
import { WORLD_CLASSIFICATIONS, WORLD_RULE_RELATIONS } from "../lib/story-bible.js";
import { SYNTHESIS_STRATEGIES, type SynthesisStrategy } from "../lib/pipeline.js";
import { isPlainObject, nonEmptyString, positiveInt } from "../lib/schema-primitives.js";
import type { ExtractionAxisReport, KindReport, SweepReport } from "./axes/extraction-axis.js";

/**
 * The wire vocabulary re-exported for consumers of the `@writer-os/benchmark/events`
 * subpath: event payload types they annotate against, plus the runtime kind
 * list the Story Facts viewer groups by.
 */
export { ENTITY_KINDS } from "../lib/story-facts.js";
export { SYNTHESIS_STRATEGIES } from "../lib/pipeline.js";
export { WORLD_CLASSIFICATIONS, WORLD_RULE_RELATIONS } from "../lib/story-bible.js";
export { isPlainObject, nonEmptyString, positiveInt } from "../lib/schema-primitives.js";
export { AXES, JUDGES, PIPELINES } from "./types.js";
export type { Axis, JudgeKind, PipelineKind } from "./types.js";
export type { StoryFacts, EntityKind, ThreadStatus } from "../lib/story-facts.js";
export type { Expectation } from "../lib/assertions.js";
export type { ExtractionSnapshot } from "../lib/extraction-run.js";
export type { GateCheck, GateEvaluation } from "../lib/gates.js";
export type { Stats } from "../lib/metrics.js";
export type {
  StoryBible,
  ModelSections,
  ModelSectionKey,
  BibleSnapshot,
  ChapterSummaryEntry,
  CharacterProfile,
  CharacterRelationship,
  GraphData,
  GraphNode,
  GraphEdge,
  LocationProfile,
  LocationCharacterSeen,
  WorldClassification,
  WorldRule,
  WorldRuleRelation,
  WorldSection,
} from "../lib/story-bible.js";
export type { SynthesisStrategy } from "../lib/pipeline.js";
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
  /** The full Story Facts snapshot after this chapter. */
  readonly facts: StoryFacts;
  /** The synthesized summary of this chapter (issue #14). */
  readonly chapterSummary: string;
  /** The full Story Bible as of this chapter (issue #14). */
  readonly bible: StoryBible;
  /** The synthesis strategy used, stamped for transparency (issue #14). */
  readonly synthesis: SynthesisStrategy;
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
  /** The final Story Facts — the snapshot after the last chapter of the last run. */
  readonly facts: StoryFacts;
  /** Every per-ordinal snapshot of the final run ("as of chapter N"). */
  readonly snapshots: readonly ExtractionSnapshot[];
  readonly evidence: readonly ExtractionEvidenceLine[];
  /** The final Story Bible of the last run (issue #14). */
  readonly bible: StoryBible;
  /** Every per-ordinal bible snapshot of the final run (issue #14). */
  readonly bibleSnapshots: readonly BibleSnapshot[];
  /** The synthesis strategy used, stamped for transparency (issue #14). */
  readonly synthesis: SynthesisStrategy;
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

const parseCharacter: Parser<StoryFacts["characters"][number]> = recordWith((r) => {
  const name = required(r, "name", parseNonEmptyString);
  return name !== null ? { name } : null;
});

const parseAppearance: Parser<StoryFacts["appearances"][number]> = recordWith((r) => {
  const character = required(r, "character", parseString);
  const attribute = required(r, "attribute", parseString);
  const contains = required(r, "contains", parseString);
  return character !== null && attribute !== null && contains !== null
    ? { character, attribute, contains }
    : null;
});

const parseRelationship: Parser<StoryFacts["relationships"][number]> = recordWith((r) => {
  const from = required(r, "from", parseString);
  const to = required(r, "to", parseString);
  const relationType = required(r, "relationType", parseString);
  return from !== null && to !== null && relationType !== null ? { from, to, relationType } : null;
});

const parseItem: Parser<StoryFacts["items"][number]> = recordWith((r) => {
  const item = required(r, "item", parseString);
  const holder = required(r, "holder", parseString);
  return item !== null && holder !== null ? { item, holder } : null;
});

const parseLocation: Parser<StoryFacts["locations"][number]> = recordWith((r) => {
  const name = required(r, "name", parseNonEmptyString);
  return name !== null ? { name } : null;
});

const parseThread: Parser<StoryFacts["threads"][number]> = recordWith((r) => {
  const thread = required(r, "thread", parseString);
  const status = required(r, "status", parseThreadStatus);
  return thread !== null && status !== null ? { thread, status } : null;
});

const parseWorldRule: Parser<StoryFacts["worldRules"][number]> = recordWith((r) => {
  const topic = required(r, "topic", parseString);
  return topic !== null ? { topic } : null;
});

const parseLexicon: Parser<StoryFacts["lexicon"][number]> = recordWith((r) => {
  const term = required(r, "term", parseString);
  const lockedSpelling = required(r, "lockedSpelling", parseBoolean);
  return term !== null && lockedSpelling !== null ? { term, lockedSpelling } : null;
});

const parseStyle: Parser<StoryFacts["style"][number]> = recordWith((r) => {
  const field = required(r, "field", parseString);
  const value = required(r, "value", parseString);
  return field !== null && value !== null ? { field, value } : null;
});

export const parseStoryFacts: Parser<StoryFacts> = recordWith((r) => {
  const characters = required(r, "characters", (v) => parseArray(v, parseCharacter));
  const appearances = required(r, "appearances", (v) => parseArray(v, parseAppearance));
  const relationships = required(r, "relationships", (v) => parseArray(v, parseRelationship));
  const items = required(r, "items", (v) => parseArray(v, parseItem));
  const locations = required(r, "locations", (v) => parseArray(v, parseLocation));
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
    locations === null ||
    threads === null ||
    worldRules === null ||
    timeline === null ||
    lexicon === null ||
    style === null
  ) {
    return null;
  }
  return {
    characters,
    appearances,
    relationships,
    items,
    locations,
    threads,
    worldRules,
    timeline,
    lexicon,
    style,
  };
});

const parseSnapshot: Parser<ExtractionSnapshot> = recordWith((r) => {
  const afterOrdinal = required(r, "afterOrdinal", parsePositiveInt);
  const facts = required(r, "facts", parseStoryFacts);
  return afterOrdinal !== null && facts !== null ? { afterOrdinal, facts } : null;
});

/* Story Bible wire parsers (issue #14) — every member required, strict. */

const parseSynthesisStrategy: Parser<SynthesisStrategy> = oneOf(SYNTHESIS_STRATEGIES);

const parseChapterSummary: Parser<ChapterSummaryEntry> = recordWith((r) => {
  const ordinal = required(r, "ordinal", parsePositiveInt);
  const summary = required(r, "summary", parseString);
  return ordinal !== null && summary !== null ? { ordinal, summary } : null;
});

const parseWorldClassification: Parser<WorldClassification> = oneOf(WORLD_CLASSIFICATIONS);
const parseWorldRuleRelation: Parser<WorldRuleRelation> = oneOf(WORLD_RULE_RELATIONS);

const parseWorldRuleEntry: Parser<WorldRule> = recordWith((r) => {
  const rule = required(r, "rule", parseNonEmptyString);
  const relation = required(r, "relation", parseWorldRuleRelation);
  const note = required(r, "note", parseString);
  return rule !== null && relation !== null && note !== null ? { rule, relation, note } : null;
});

const parseWorldSection: Parser<WorldSection> = recordWith((r) => {
  const classification = required(r, "classification", parseWorldClassification);
  const description = required(r, "description", parseString);
  const rules = required(r, "rules", (v) => parseArray(v, parseWorldRuleEntry));
  return classification !== null && description !== null && rules !== null
    ? { classification, description, rules }
    : null;
});

const parseCharacterRelationship: Parser<CharacterRelationship> = recordWith((r) => {
  const other = required(r, "other", parseNonEmptyString);
  const summary = required(r, "summary", parseNonEmptyString);
  return other !== null && summary !== null ? { other, summary } : null;
});

/** The rich character profile (issue #15), field-strict: nothing optional. */
const parseCharacterProfile: Parser<CharacterProfile> = recordWith((r) => {
  const name = required(r, "name", parseNonEmptyString);
  const appearance = required(r, "appearance", parseString);
  const personality = required(r, "personality", parseString);
  const definingTraits = required(r, "definingTraits", (v) => parseArray(v, parseNonEmptyString));
  const background = required(r, "background", parseString);
  const arc = required(r, "arc", parseString);
  const firstAppearanceOrdinal = required(r, "firstAppearanceOrdinal", parsePositiveInt);
  const mentionOrdinals = required(r, "mentionOrdinals", (v) => parseArray(v, parsePositiveInt));
  const relationships = required(r, "relationships", (v) =>
    parseArray(v, parseCharacterRelationship),
  );
  return name !== null &&
    appearance !== null &&
    personality !== null &&
    definingTraits !== null &&
    background !== null &&
    arc !== null &&
    firstAppearanceOrdinal !== null &&
    mentionOrdinals !== null &&
    relationships !== null
    ? {
        name,
        appearance,
        personality,
        definingTraits,
        background,
        arc,
        firstAppearanceOrdinal,
        mentionOrdinals,
        relationships,
      }
    : null;
});

const parseLocationCharacterSeen: Parser<LocationCharacterSeen> = recordWith((r) => {
  const character = required(r, "character", parseNonEmptyString);
  const firstCoOccurrenceOrdinal = required(r, "firstCoOccurrenceOrdinal", parsePositiveInt);
  return character !== null && firstCoOccurrenceOrdinal !== null
    ? { character, firstCoOccurrenceOrdinal }
    : null;
});

/** The location profile (issue #17), field-strict: nothing optional. */
const parseLocationProfile: Parser<LocationProfile> = recordWith((r) => {
  const name = required(r, "name", parseNonEmptyString);
  const description = required(r, "description", parseString);
  const significance = required(r, "significance", parseString);
  const charactersSeen = required(r, "charactersSeen", (v) =>
    parseArray(v, parseLocationCharacterSeen),
  );
  return name !== null && description !== null && significance !== null && charactersSeen !== null
    ? { name, description, significance, charactersSeen }
    : null;
});

const parseThreadRollup: Parser<StoryBible["threadRollups"][number]> = recordWith((r) => {
  const thread = required(r, "thread", parseNonEmptyString);
  const status = required(r, "status", parseThreadStatus);
  const rollup = required(r, "rollup", parseString);
  return thread !== null && status !== null && rollup !== null ? { thread, status, rollup } : null;
});

const parseNamedDescription: Parser<StoryBible["groups"][number]> = recordWith((r) => {
  const name = required(r, "name", parseNonEmptyString);
  const description = required(r, "description", parseString);
  return name !== null && description !== null ? { name, description } : null;
});

const parseLexiconNote: Parser<StoryBible["lexiconNotes"][number]> = recordWith((r) => {
  const term = required(r, "term", parseNonEmptyString);
  const note = required(r, "note", parseString);
  return term !== null && note !== null ? { term, note } : null;
});

const parseOpenLoop: Parser<StoryBible["openLoops"][number]> = recordWith((r) => {
  const description = required(r, "description", parseNonEmptyString);
  const openedAtOrdinal = required(r, "openedAtOrdinal", parsePositiveInt);
  return description !== null && openedAtOrdinal !== null ? { description, openedAtOrdinal } : null;
});

const parseStyleField: Parser<StoryBible["styleRollup"][number]> = recordWith((r) => {
  const field = required(r, "field", parseNonEmptyString);
  const value = required(r, "value", parseString);
  return field !== null && value !== null ? { field, value } : null;
});

const parseGraphNode: Parser<GraphData["nodes"][number]> = recordWith((r) => {
  const name = required(r, "name", parseNonEmptyString);
  const importance = required(r, "importance", parseNonNegativeInt);
  const role = required(r, "role", oneOf(["protagonist", "supporting"] as const));
  return name !== null && importance !== null && role !== null ? { name, importance, role } : null;
});

const parseGraphEdge: Parser<GraphData["edges"][number]> = recordWith((r) => {
  const from = required(r, "from", parseNonEmptyString);
  const to = required(r, "to", parseNonEmptyString);
  const relation = required(r, "relation", parseNonEmptyString);
  return from !== null && to !== null && relation !== null ? { from, to, relation } : null;
});

const parseGraphData: Parser<GraphData> = recordWith((r) => {
  const nodes = required(r, "nodes", (v) => parseArray(v, parseGraphNode));
  const edges = required(r, "edges", (v) => parseArray(v, parseGraphEdge));
  return nodes !== null && edges !== null ? { nodes, edges } : null;
});

const parseStoryBible: Parser<StoryBible> = recordWith((r) => {
  const bookOverview = required(r, "bookOverview", parseString);
  const world = required(r, "world", parseWorldSection);
  const characterProfiles = required(r, "characterProfiles", (v) =>
    parseArray(v, parseCharacterProfile),
  );
  const locations = required(r, "locations", (v) => parseArray(v, parseLocationProfile));
  const threadRollups = required(r, "threadRollups", (v) => parseArray(v, parseThreadRollup));
  const groups = required(r, "groups", (v) => parseArray(v, parseNamedDescription));
  const itemsOfSignificance = required(r, "itemsOfSignificance", (v) =>
    parseArray(v, parseNamedDescription),
  );
  const lexiconNotes = required(r, "lexiconNotes", (v) => parseArray(v, parseLexiconNote));
  const openLoops = required(r, "openLoops", (v) => parseArray(v, parseOpenLoop));
  const styleRollup = required(r, "styleRollup", (v) => parseArray(v, parseStyleField));
  const worldTimeline = required(r, "worldTimeline", (v) => parseArray(v, parseNonEmptyString));
  const bookTimeline = required(r, "bookTimeline", (v) => parseArray(v, parseNonEmptyString));
  const chapterSummaries = required(r, "chapterSummaries", (v) => parseArray(v, parseChapterSummary));
  const graph = required(r, "graph", parseGraphData);
  if (
    bookOverview === null ||
    world === null ||
    characterProfiles === null ||
    locations === null ||
    threadRollups === null ||
    groups === null ||
    itemsOfSignificance === null ||
    lexiconNotes === null ||
    openLoops === null ||
    styleRollup === null ||
    worldTimeline === null ||
    bookTimeline === null ||
    chapterSummaries === null ||
    graph === null
  ) {
    return null;
  }
  return {
    bookOverview,
    world,
    characterProfiles,
    locations,
    threadRollups,
    groups,
    itemsOfSignificance,
    lexiconNotes,
    openLoops,
    styleRollup,
    worldTimeline,
    bookTimeline,
    chapterSummaries,
    graph,
  };
});

const parseBibleSnapshot: Parser<BibleSnapshot> = recordWith((r) => {
  const afterOrdinal = required(r, "afterOrdinal", parsePositiveInt);
  const bible = required(r, "bible", parseStoryBible);
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
      const facts = required(record, "facts", parseStoryFacts);
      const chapterSummary = required(record, "chapterSummary", parseString);
      const bible = required(record, "bible", parseStoryBible);
      const synthesis = required(record, "synthesis", parseSynthesisStrategy);
      return ordinal !== null &&
        runIndex !== null &&
        elapsedMs !== null &&
        canonEntries !== null &&
        facts !== null &&
        chapterSummary !== null &&
        bible !== null &&
        synthesis !== null
        ? { type, ordinal, runIndex, elapsedMs, canonEntries, facts, chapterSummary, bible, synthesis }
        : null;
    }
    case "run.completed": {
      const exitCode = required(record, "exitCode", parseNonNegativeInt);
      const report = required(record, "report", parseAxisReport);
      const facts = required(record, "facts", parseStoryFacts);
      const snapshots = required(record, "snapshots", (v) => parseArray(v, parseSnapshot));
      const evidence = required(record, "evidence", (v) => parseArray(v, parseEvidenceLine));
      const bible = required(record, "bible", parseStoryBible);
      const bibleSnapshots = required(record, "bibleSnapshots", (v) =>
        parseArray(v, parseBibleSnapshot),
      );
      const synthesis = required(record, "synthesis", parseSynthesisStrategy);
      return exitCode !== null &&
        report !== null &&
        facts !== null &&
        snapshots !== null &&
        evidence !== null &&
        bible !== null &&
        bibleSnapshots !== null &&
        synthesis !== null
        ? { type, exitCode, report, facts, snapshots, evidence, bible, bibleSnapshots, synthesis }
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
