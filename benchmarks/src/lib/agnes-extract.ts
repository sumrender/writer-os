import {
  ENTITY_KINDS,
  THREAD_STATUSES,
  type EntityKind,
  type ThreadStatus,
} from "./bible.js";
import { applyFact, type ExtractedFact } from "./bible-merge.js";
import { bibleFacts } from "./fact-text.js";
import { isPlainObject, nonEmptyString } from "./schema-primitives.js";
import { firstForcedToolArguments } from "./agnes-response.js";
import { assertWithinContextWindow, type AgnesClient, type ChatCompletionRequest } from "./agnes-client.js";
import type { ResponseCache } from "./response-cache.js";
import { hashVerdictInput } from "./verdict-cache.js";
import type { Extract } from "./pipeline.js";
import { silentLogger, type Logger } from "./logger.js";

/**
 * Vendor-backed extractor behind the pipeline `Extract` port (ADR-0004,
 * docs/TESTING.md axis 1). Delta extraction: the model sees one chapter plus
 * the canon established so far and returns only facts THAT chapter text
 * establishes, as forced-tool structured output (the model has no JSON-schema
 * response mode). Facts are validated precisely at the trust boundary and
 * merged onto canon through the shared merge algebra (lib/bible-merge.ts),
 * so grader-visible state is identical regardless of fact origin.
 */

export const EXTRACT_MAX_TOKENS = 16_384;

const EXTRACT_SYSTEM = [
  "You are a Story Bible extractor grading fixture extraction fidelity.",
  "For each fact THIS chapter's text establishes, emit exactly one fact;",
  "emit nothing the chapter does not support, and preserve source spellings exactly.",
  "Merge semantics you must respect: character names dedupe automatically;",
  "an item's holder, a thread's status, and style field/value REPLACE their prior canon values",
  "when changed, so re-emit them on change; timeline events append in read order;",
  "appearances, relationships, world rules, and lexicon terms append when genuinely new.",
  "The nine kinds carry exact fields:",
  "character{name}; appearance{character,attribute,contains}; relationship{from,to,relationType};",
  "item{item,holder}; thread{thread,status: open|resolved|dormant}; world_rule{topic};",
  "timeline{event}; lexicon{term,lockedSpelling}; style{field,value}.",
  "A fact object carries EXACTLY its kind's fields and no others.",
  "Emit an empty facts array when the chapter establishes nothing.",
].join(" ");

const EXTRACT_TOOL = {
  type: "function",
  function: {
    name: "record_facts",
    description: "Record Story Bible facts newly established by this chapter.",
    parameters: {
      type: "object",
      properties: {
        facts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: [...ENTITY_KINDS] },
              name: { type: "string" },
              character: { type: "string" },
              attribute: { type: "string" },
              contains: { type: "string" },
              from: { type: "string" },
              to: { type: "string" },
              relationType: { type: "string" },
              item: { type: "string" },
              holder: { type: "string" },
              thread: { type: "string" },
              status: { type: "string", enum: [...THREAD_STATUSES] },
              topic: { type: "string" },
              event: { type: "string" },
              term: { type: "string" },
              lockedSpelling: { type: "boolean" },
              field: { type: "string" },
              value: { type: "string" },
            },
            required: ["kind"],
          },
        },
      },
      required: ["facts"],
      additionalProperties: false,
    },
  },
} as const;

function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === "string" && (ENTITY_KINDS as readonly string[]).includes(value);
}

function isThreadStatus(value: unknown): value is ThreadStatus {
  return typeof value === "string" && (THREAD_STATUSES as readonly string[]).includes(value);
}

/**
 * Coerces a model-typed value to a strict boolean for the few fields whose
 * schema demands one (e.g. `lexicon.lockedSpelling`). The system prompt
 * says "preserve source spellings exactly" — i.e. lockedSpelling defaults
 * to `true` when the model omits it. When the model types a string instead
 * of a real bool, only a small explicit set coerces; everything else
 * surfaces as `undefined` so the caller can decide (skip with a precise
 * reason, never silently guess).
 */
const TRUE_LITERALS: ReadonlySet<string> = new Set([
  "true",
  "yes",
  "locked",
  "locked_spelling",
  "lockedspelling",
  "1",
]);
const FALSE_LITERALS: ReadonlySet<string> = new Set([
  "false",
  "no",
  "unlocked",
  "0",
]);

export function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (TRUE_LITERALS.has(normalized)) return true;
  if (FALSE_LITERALS.has(normalized)) return false;
  return undefined;
}

function fail(index: number, problem: string): never {
  throw new Error(`extracted fact #${index}: ${problem}`);
}

function stringField(
  raw: Record<string, unknown>,
  field: string,
  index: number,
): string {
  const value = raw[field];
  if (!nonEmptyString(value)) {
    // Fields normalized from explicit vendor nulls or omitted by a resolved
    // partial fact (see inferMissingKind) yield ""; everything else fails.
    if ((value === undefined || value === "") && NULL_NORMALIZED.get(raw)?.has(field)) {
      return "";
    }
    fail(index, `"${field}" must be a non-empty string`);
  }
  return value;
}

/**
 * Variant of {@link stringField} that tolerates a missing or empty value,
 * returning the empty string. Used for fields the model may treat as
 * self-describing (e.g. an appearance's `contains` when the attribute
 * name already implies the visual fact). The empty value flows through
 * canon unchanged; graders exact-match on it and surface mismatches.
 */
function containsOrEmpty(raw: Record<string, unknown>, field: string): string {
  const value = raw[field];
  if (nonEmptyString(value)) return value;
  return "";
}

/** Per-object set of keys the vendor sent as explicit null (empty-tolerant). */
const NULL_NORMALIZED = new WeakMap<Record<string, unknown>, ReadonlySet<string>>();

/**
 * The exact field set of every fact kind, shared by shape validation,
 * stray-field tolerance, and missing-kind canonicalization below.
 */
const FIELDS_BY_KIND: Readonly<Record<EntityKind, readonly string[]>> = {
  character: ["name"],
  appearance: ["character", "attribute", "contains"],
  relationship: ["from", "to", "relationType"],
  item: ["item", "holder"],
  thread: ["thread", "status"],
  world_rule: ["topic"],
  timeline: ["event"],
  lexicon: ["term", "lockedSpelling"],
  style: ["field", "value"],
};

/** Every field any fact kind may carry (the union of the nine kinds' shapes). */
const FACT_FIELD_NAMES = new Set(Object.values(FIELDS_BY_KIND).flat());

/** The nine kind names — when one of these appears as a stray sibling key
 * (e.g. `{kind: "appearance", …, appearance: {noise}}`) it is the kind's
 * own wrapper sub-object leaked as a top-level field, not a real fact field. */
const KIND_NAMES = new Set<string>(ENTITY_KINDS);

function factSnippet(raw: Record<string, unknown>): string {
  return JSON.stringify(raw).slice(0, 160);
}

/**
 * Enforces per-kind shape at the trust boundary. Agnes exposes no per-kind
 * schema enforcement (the forced-tool parameters are flat across kinds and
 * there is no JSON-schema response mode), so real models occasionally carry
 * another kind's field on a fact (e.g. `character` alongside a character
 * fact's `name`). That schema noise is dropped here: canonical entries are
 * reconstructed explicitly by each case below, so noise can never reach canon
 * state. Genuinely unknown keys remain a hard error, reported with a raw
 * snippet so malformed vendor output stays diagnosable.
 */
function rejectExtraFields(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  index: number,
): void {
  for (const key of Object.keys(raw)) {
    if (key !== "kind" && !allowed.includes(key)) {
      // Genuinely unknown keys are hard errors; another kind's stray field
      // (schema noise Agnes cannot prevent) is dropped silently because
      // canonical entries are reconstructed explicitly below. A stray key
      // whose name IS a kind name is the kind's own wrapper sub-object
      // leaked as a top-level field (e.g. {kind:"appearance",…,
      // appearance:{noise}}); same treatment.
      if (!FACT_FIELD_NAMES.has(key) && !KIND_NAMES.has(key)) {
        fail(index, `unexpected field "${key}" for this kind (allowed: ${allowed.join(", ")})`);
      }
    }
  }
}

/**
 * Validates one model-returned fact precisely, preserving exact typing.
 * `rejectExtraFields` tolerates another kind's stray field (schema noise
 * Agnes cannot prevent); genuinely unknown keys stay a hard error.
 *
 * Returns an array because the multi-kind splitter can recover one
 * malformed emission as several real facts. The vast majority of
 * invocations return a single-element array.
 */
function validateFact(rawInput: unknown, index: number): readonly ExtractedFact[] {
  if (!isPlainObject(rawInput)) fail(index, "must be an object");
  // Vendor noise observed live on real books: text fields arriving as explicit
  // null mean "none" — normalized to the empty string, and emptyness is then
  // tolerated for exactly those keys (a model-typed "" still fails strictly).
  const nulled = new Set(
    Object.keys(rawInput).filter((key) => rawInput[key] === null),
  );
  let raw: Record<string, unknown> =
    nulled.size === 0 ? rawInput : { ...rawInput, ...Object.fromEntries([...nulled].map((k) => [k, ""])) };
  if (nulled.size > 0) NULL_NORMALIZED.set(raw, nulled);
  // Vendor-observed live: the whole fact wrapped under its kind name,
  // {"appearance":{"attribute":…,…}} — unwrapped deterministically because
  // the wrapper key IS the kind. Observed shapes:
  //   • kind absent: {"appearance":{"attribute":…,…}}
  //   • kind explicit and matching the wrapper, wrapper holds the data:
  //     {"appearance":{"character":…,"attribute":…,"contains":…},"kind":"appearance"}
  //   • kind explicit, wrapper holds the data AND some of those fields also
  //     appear at the top level (e.g. chapter 30 thread:
  //     {"thread":{"status":"resolved","thread":"…"},"kind":"thread"} — the
  //     "thread" sibling key matches the wrapper key, so the original guard
  //     wrongly thought the data was already at the top level).
  // All three mean: the payload sits under the kind's own name.
  // Guard: only unwrap when the kind's required fields are NOT already
  // present as plain top-level values (i.e. the wrapper is the canonical
  // payload). A stray wrapper sub-object alongside a real fact is dropped
  // by `rejectExtraFields`.
  if (raw["kind"] === undefined && Object.keys(raw).length === 1) {
    const onlyKey = Object.keys(raw)[0];
    const value = onlyKey === undefined ? undefined : raw[onlyKey];
    if (onlyKey !== undefined && isEntityKind(onlyKey) && isPlainObject(value)) {
      raw = { ...value, kind: onlyKey };
    }
  } else if (isEntityKind(raw["kind"])) {
    const kindName = raw["kind"];
    const wrapped = raw[kindName];
    if (isPlainObject(wrapped)) {
      const required = FIELDS_BY_KIND[kindName];
      const topLevelHasAll = required.every((field) => {
        const v = raw[field];
        return nonEmptyString(v) || (v === "" && NULL_NORMALIZED.get(raw)?.has(field));
      });
      if (!topLevelHasAll) {
        raw = { ...wrapped, kind: kindName };
      }
    }
  }
  // Vendor-observed canonicalizations (documented, deterministic):
  // 1. A thread whose identity arrived under `name` — with `status` present,
  //    "name" can only mean the thread's label, never a character fact.
  if (
    (raw["kind"] === "thread" || raw["kind"] === undefined) &&
    !("thread" in raw) &&
    "status" in raw &&
    typeof raw["name"] === "string"
  ) {
    raw = { ...raw, thread: raw["name"] };
  }
  // 2. A bare character mention with no `name`: {"character":"X"} (with or
  //    without kind:"character") and no other content keys can only denote
  //    a newly established character.
  if (
    Object.keys(raw).every((k) => k === "kind" || k === "character") &&
    nonEmptyString(raw["character"])
  ) {
    return [{ kind: "character", name: raw["character"] }];
  }
  // 3. Multi-kind compound: when the model conflates two facts in one
  //    emission (e.g. {event: X, thread: Y} → timeline + thread), and no
  //    kind's full required set is satisfied, attempt to split before
  //    bailing out. The splitter returns undefined when assignment is
  //    ambiguous; the caller then falls through to the precise hard error.
  if (raw["kind"] === undefined) {
    const split = trySplitFields(raw, index);
    if (split !== undefined) return split;
  }
  let kind: EntityKind;
  if (isEntityKind(raw["kind"])) {
    kind = raw["kind"];
  } else if (raw["kind"] === undefined) {
    kind = inferMissingKind(raw, index);
  } else {
    fail(index, `"kind" must be one of ${ENTITY_KINDS.join(", ")}`);
  }
  switch (kind) {
    case "character": {
      rejectExtraFields(raw, FIELDS_BY_KIND[kind], index);
      return [{ kind, name: stringField(raw, "name", index) }];
    }
    case "appearance": {
      rejectExtraFields(raw, FIELDS_BY_KIND[kind], index);
      return [
        {
          kind,
          character: stringField(raw, "character", index),
          attribute: stringField(raw, "attribute", index),
          // The model occasionally treats `attribute` as self-describing and
          // omits `contains` (e.g. attribute "spectacles" implies the visual
          // fact). Defaulting to "" keeps the fact in canon so the rest of
          // the run builds on it; graders exact-match on contains will still
          // surface this as an omission when an assertion expects text.
          contains: containsOrEmpty(raw, "contains"),
        },
      ];
    }
    case "relationship": {
      rejectExtraFields(raw, FIELDS_BY_KIND[kind], index);
      return [
        {
          kind,
          from: stringField(raw, "from", index),
          to: stringField(raw, "to", index),
          relationType: stringField(raw, "relationType", index),
        },
      ];
    }
    case "item": {
      rejectExtraFields(raw, FIELDS_BY_KIND[kind], index);
      return [
        {
          kind,
          item: stringField(raw, "item", index),
          holder: stringField(raw, "holder", index),
        },
      ];
    }
    case "thread": {
      rejectExtraFields(raw, FIELDS_BY_KIND[kind], index);
      const status = raw["status"];
      if (!isThreadStatus(status)) {
        fail(index, `"status" must be one of ${THREAD_STATUSES.join(", ")}`);
      }
      return [{ kind, thread: stringField(raw, "thread", index), status }];
    }
    case "world_rule": {
      rejectExtraFields(raw, FIELDS_BY_KIND[kind], index);
      return [{ kind, topic: stringField(raw, "topic", index) }];
    }
    case "timeline": {
      rejectExtraFields(raw, FIELDS_BY_KIND[kind], index);
      return [{ kind, event: stringField(raw, "event", index) }];
    }
    case "lexicon": {
      rejectExtraFields(raw, FIELDS_BY_KIND[kind], index);
      const term = stringField(raw, "term", index);
      // The system prompt says "preserve source spellings exactly" — i.e.
      // lockedSpelling defaults to `true` when the model omits it. A
      // model-typed non-boolean (e.g. "yes") is coerced through a small
      // explicit set; anything truly non-coercible skips the fact.
      const provided = raw["lockedSpelling"];
      const coerced = coerceBoolean(provided);
      if (provided === undefined) {
        return [{ kind, term, lockedSpelling: true }];
      }
      if (coerced === undefined) {
        fail(index, `"lockedSpelling" must be true or false (got: ${JSON.stringify(provided)})`);
      }
      return [{ kind, term, lockedSpelling: coerced }];
    }
    case "style": {
      rejectExtraFields(raw, FIELDS_BY_KIND[kind], index);
      return [
        {
          kind,
          field: stringField(raw, "field", index),
          value: stringField(raw, "value", index),
        },
      ];
    }
  }
}

/**
 * Canonicalizes missing-`kind` vendor noise against the nine disjoint kind
 * shapes. Exact-match preferred: remaining keys equal exactly one kind's
 * field set. Subset fallback: every observed field name is globally unique
 * to one kind, so a non-empty subset can resolve unambiguously too (fields
 * the vendor omitted normalize to "", like explicit nulls — losing only what
 * the model never provided). Zero or multiple candidates stay a precise hard
 * error so malformed vendor output is never silently guessed.
 */
function inferMissingKind(raw: Record<string, unknown>, index: number): EntityKind {
  const present = Object.keys(raw);
  let resolved: EntityKind | undefined;
  let partial = false;
  for (const candidate of ENTITY_KINDS) {
    const fields = FIELDS_BY_KIND[candidate];
    const exact = present.length === fields.length && fields.every((f) => present.includes(f));
    const subsumes = present.length > 0 && present.every((f) => fields.includes(f));
    if (!exact && !subsumes) continue;
    if (resolved !== undefined) {
      fail(index, `"kind" is missing and its fields resolve ambiguously (${resolved} vs ${candidate})`);
    }
    resolved = candidate;
    partial = !exact;
  }
  if (resolved === undefined) {
    fail(
      index,
      `"kind" is missing and its fields ${JSON.stringify(present)} do not match exactly one fact kind`,
    );
  }
  if (partial) {
    // Register the omitted fields so stringField accepts their "" values.
    const omitted = FIELDS_BY_KIND[resolved].filter((field) => !present.includes(field));
    NULL_NORMALIZED.set(raw, new Set([...(NULL_NORMALIZED.get(raw) ?? []), ...omitted]));
  }
  return resolved;
}

/**
 * Inverts {@link FIELDS_BY_KIND}: every field name maps to the set of kinds
 * that own it. Most field names are globally unique to one kind; a few
 * collisions exist (e.g. `character` is both the appearance's `character`
 * and a bare character-fact's only key, `thread` is the thread's own name
 * and used as a value field). Used by the multi-kind splitter below.
 */
const KINDS_BY_FIELD: ReadonlyMap<string, readonly EntityKind[]> = (() => {
  const map = new Map<string, EntityKind[]>();
  for (const kind of ENTITY_KINDS) {
    for (const field of FIELDS_BY_KIND[kind]) {
      const existing = map.get(field);
      if (existing === undefined) {
        map.set(field, [kind]);
      } else {
        existing.push(kind);
      }
    }
  }
  return map;
})();

/**
 * Multi-kind recovery: when the model emits a compound fact whose fields
 * map to multiple kinds (e.g. `{event: X, thread: Y}` or `{attribute: A,
 * character: C, contains: K, holder: H, item: I}` — observed live when the
 * model conflates two facts in one emission), attempt to split it into
 * one fact per kind whose required fields are fully present. Returns the
 * split facts, or `undefined` when the splitter cannot assign every field
 * unambiguously to exactly one kind (the caller should skip and report).
 *
 * Defaults: required fields missing from a split group are filled with the
 * type's documented "none" value — `""` for strings, `true` for
 * `lockedSpelling`, `"open"` for `status`. The empty/default values flow
 * through canon; graders exact-match on them and surface mismatches.
 */
function trySplitFields(
  raw: Record<string, unknown>,
  index: number,
): readonly ExtractedFact[] | undefined {
  const present = Object.keys(raw).filter((k) => k !== "kind");
  if (present.length < 2) return undefined;
  // Group fields by the unique kind each maps to. A field that maps to
  // multiple kinds (collision) or to no kind at all aborts the split.
  const groupByKind = new Map<EntityKind, string[]>();
  for (const field of present) {
    const kinds = KINDS_BY_FIELD.get(field);
    if (kinds === undefined || kinds.length !== 1) return undefined;
    const kind = kinds[0];
    if (kind === undefined) return undefined;
    const bucket = groupByKind.get(kind) ?? [];
    bucket.push(field);
    groupByKind.set(kind, bucket);
  }
  if (groupByKind.size < 2) return undefined;
  const split: ExtractedFact[] = [];
  for (const [kind, fields] of groupByKind) {
    const required = FIELDS_BY_KIND[kind];
    // The split only succeeds if this kind's required fields are all
    // accounted for in the compound emission. A missing required field
    // (e.g. relationship.relationType) means the model didn't actually
    // emit a full fact of that kind — fall back to skipping.
    if (!required.every((f) => fields.includes(f))) return undefined;
    // Re-use validateFact on a synthesized single-kind object. It applies
    // all the per-kind shape rules (defaulted fields, null tolerance, etc.).
    const single: Record<string, unknown> = { kind };
    for (const f of required) single[f] = raw[f];
    try {
      const facts = validateFact(single, index);
      split.push(...facts);
    } catch {
      return undefined;
    }
  }
  return split;
}

/** A fact that failed trust-boundary validation and was dropped from a batch. */
export interface SkippedFact {
  readonly index: number;
  readonly reason: string;
  /** Raw fact snippet (truncated) for log diagnosability. */
  readonly snippet: string;
}

export interface ParseResult {
  readonly facts: readonly ExtractedFact[];
  /** Per-fact validation failures that did not abort the batch. */
  readonly skipped: readonly SkippedFact[];
}

export function parseExtractedFacts(toolArguments: string): readonly ExtractedFact[] {
  return parseExtractedFactsDetailed(toolArguments).facts;
}

/**
 * Same parse path as {@link parseExtractedFacts}, but returns a richer
 * `ParseResult` that surfaces per-fact validation failures. Whole-batch
 * failures (non-JSON arguments, missing `facts` array) still throw — those
 * are unrecoverable without a re-prompt. Per-fact failures (malformed shape,
 * missing required field, invalid status) are isolated: the bad fact is
 * reported in `skipped` and the rest of the batch keeps producing facts.
 * Without this isolation, one unfixable fact in a 30-fact response aborts
 * the whole chapter's extraction (observed live on tom-sawyer).
 */
export function parseExtractedFactsDetailed(toolArguments: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolArguments);
  } catch {
    throw new Error(
      `extractor returned arguments that are not valid JSON: ${toolArguments.slice(0, 120)}`,
    );
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed["facts"])) {
    throw new Error('extractor arguments must carry a "facts" array');
  }
  const facts: ExtractedFact[] = [];
  const skipped: SkippedFact[] = [];
  parsed["facts"].forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      skipped.push({ index, reason: "must be an object", snippet: factSnippet(raw) });
      return;
    }
    try {
      // validateFact can return multiple facts when the multi-kind splitter
      // recovers a compound emission; flatten into the running facts list.
      for (const fact of validateFact(raw, index)) facts.push(fact);
    } catch (error) {
      // Every trust-boundary rejection carries the raw fact (truncated) so
      // malformed vendor output is diagnosable from the run log alone.
      const reason = error instanceof Error ? error.message : String(error);
      skipped.push({ index, reason, snippet: factSnippet(raw) });
    }
  });
  return { facts, skipped };
}

export function extractionUserPrompt(input: {
  readonly ordinal: number;
  readonly canonView: string;
  readonly chapterText: string;
}): string {
  return [
    `Chapter ordinal: ${input.ordinal}`,
    "",
    "Canon established so far:",
    input.canonView,
    "",
    "Chapter text:",
    input.chapterText,
    "",
    "Emit every fact the chapter text establishes and nothing it does not.",
  ].join("\n");
}

export interface AgnesExtractOptions {
  /**
   * Content-hash cache of raw extraction responses (extraction only by
   * design: temp-0 requests are input-deterministic, while generation is
   * sampled prose and checks are cheap). Hits re-enter the trust boundary —
   * stored payloads go through the same parse/validate path as fresh ones —
   * so caching changes cost, never what is measured.
   */
  readonly responseCache?: ResponseCache;
  /** Optional progress sink. */
  readonly log?: Logger;
}

/**
 * Request identity for cache keys: every field that determines the request.
 * Any prompt, tool-schema, or sampling change produces new keys, so caching
 * can never serve output produced under different code.
 */
function extractionRequestKey(
  model: string,
  request: ChatCompletionRequest,
): string {
  return hashVerdictInput("extract", {
    model,
    system: request.system,
    user: request.user,
    tools: request.tools ?? null,
    forceToolName: request.forceToolName ?? null,
    temperature: request.temperature ?? null,
    maxTokens: request.maxTokens ?? null,
  });
}

export function createAgnesExtract(
  client: AgnesClient,
  options: AgnesExtractOptions = {},
): Extract {
  const log = options.log ?? silentLogger;
  const complete = async (prompt: string): Promise<unknown> => {
    const request: ChatCompletionRequest = {
      system: EXTRACT_SYSTEM,
      user: prompt,
      tools: [EXTRACT_TOOL],
      forceToolName: EXTRACT_TOOL.function.name,
      temperature: 0,
      maxTokens: EXTRACT_MAX_TOKENS,
    };
    if (options.responseCache !== undefined) {
      const key = extractionRequestKey(client.model, request);
      const cached = options.responseCache.get(key);
      if (isPlainObject(cached)) {
        log.debug(
          `        extract cache HIT (key ${key.slice(0, 12)}…); re-validating at trust boundary`,
        );
        return cached;
      }
      log.debug(`        extract cache MISS (key ${key.slice(0, 12)}…); calling agnes`);
    }
    const response = await client.complete(request);
    options.responseCache?.set(extractionRequestKey(client.model, request), response);
    return response;
  };
  return async (chapterText, ordinal, bibleSoFar) => {
    const canonView =
      bibleFacts(bibleSoFar)
        .map((fact) => fact.text)
        .join("\n") || "(no canon established yet)";
    assertWithinContextWindow(`extraction of chapter ${ordinal}`, [
      EXTRACT_SYSTEM,
      canonView,
      chapterText,
    ]);
    const user = extractionUserPrompt({ ordinal, canonView, chapterText });
    const attempt = async (prompt: string): Promise<ParseResult> => {
      const args = firstForcedToolArguments(await complete(prompt));
      return parseExtractedFactsDetailed(args);
    };
    const logSkipped = (skipped: readonly SkippedFact[]): void => {
      for (const s of skipped) {
        log.info(
          `        extract chapter ${ordinal}: skipped fact #${s.index}: ${s.reason} near: ${s.snippet}`,
        );
      }
    };
    const RETRY_INSTRUCTIONS = [
      "Re-emit complete corrected arguments. EVERY fact must carry \"kind\" set to",
      "one of character, appearance, relationship, item, thread, world_rule, timeline, lexicon, style,",
      "with exactly that kind's fields and no others:",
      "character{name}; appearance{character,attribute,contains}; relationship{from,to,relationType};",
      "item{item,holder}; thread{thread,status}; world_rule{topic}; timeline{event}; lexicon{term,lockedSpelling}; style{field,value}.",
    ];
    let result: ParseResult | undefined;
    let problem = "";
    try {
      result = await attempt(user);
    } catch (error) {
      // Whole-batch failure only (non-JSON, missing `facts` array, etc.)
      // — per-fact issues never reach here because parseExtractedFactsDetailed
      // isolates them. One self-healing retry re-prompts the model with the
      // failure attached so a structured-output mishap cannot kill a run.
      problem = error instanceof Error ? error.message : String(error);
      log.info(`        extract batch invalid for chapter ${ordinal}, retrying: ${problem}`);
    }
    if (result === undefined || result.skipped.length > 0) {
      // Also self-heal per-fact skips: skipped facts become extraction
      // omissions, and the dominant skip cause is a mechanical model quirk
      // (facts missing "kind"). One retry feeding every rejection back; the
      // corrected batch is adopted only when it recovers more facts.
      const detail =
        result === undefined
          ? problem
          : result.skipped
              .map((s) => `#${s.index}: ${s.reason} near: ${s.snippet}`)
              .join("; ");
      if (result !== undefined) {
        log.info(
          `        extract chapter ${ordinal}: ${result.skipped.length} fact(s) skipped, retrying to recover them`,
        );
      }
      const retryUser = [
        user,
        "",
        `Your previous record_facts call was rejected by validation: ${detail}`,
        ...RETRY_INSTRUCTIONS,
      ].join("\n");
      let retry: ParseResult | undefined;
      try {
        retry = await attempt(retryUser);
      } catch (retryError) {
        if (result === undefined) {
          const retryProblem = retryError instanceof Error ? retryError.message : String(retryError);
          log.info(`        extract retry also failed for chapter ${ordinal}`);
          throw new Error(`extraction retry after "${problem}" also failed: ${retryProblem}`);
        }
        // The first attempt yielded partial facts; keep them rather than
        // letting a failed salvage retry discard valid work.
      }
      if (
        retry !== undefined &&
        (result === undefined || retry.skipped.length < result.skipped.length)
      ) {
        log.info(`        extract retry succeeded for chapter ${ordinal}`);
        result = retry;
      }
    }
    if (result === undefined) {
      throw new Error(`extraction produced no usable batch for chapter ${ordinal}: ${problem}`);
    }
    logSkipped(result.skipped);
    const facts = result.facts;
    log.debug(`        extract chapter ${ordinal}: ${facts.length} fact(s) parsed`);
    return facts.reduce((state, fact) => applyFact(state, fact), bibleSoFar);
  };
}

