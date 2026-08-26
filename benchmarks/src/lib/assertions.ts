import {
  ENTITY_KINDS,
  THREAD_STATUSES,
  type EntityKind,
  type ThreadStatus,
} from "./bible.js";

/**
 * Assertion-set schema (docs/TESTING.md §5): the typed, human-verified claims
 * encoding a fixture book's ground truth. Wire format (YAML) uses snake_case;
 * this module validates that format and produces the typed internal form.
 */

export const ASSERTION_KINDS = ENTITY_KINDS;

export type AssertionKind = EntityKind;
export type Expectation = "must" | "must_not";

interface CommonFields {
  readonly id: string;
  readonly expect: Expectation;
  /** Ordinal at which the assertion is graded; undefined means final ordinal. */
  readonly asOf?: number;
  /** Chapter ordinals establishing the claim ([] only for evidence-free must_not). */
  readonly evidence: readonly number[];
  readonly note?: string;
}

export interface CharacterAssertion extends CommonFields {
  readonly kind: "character";
  readonly name: string;
}

export interface AppearanceAssertion extends CommonFields {
  readonly kind: "appearance";
  readonly character: string;
  readonly attribute: string;
  readonly contains: string;
}

export interface RelationshipAssertion extends CommonFields {
  readonly kind: "relationship";
  readonly from: string;
  readonly to: string;
  readonly relationType: string;
}

export interface ItemAssertion extends CommonFields {
  readonly kind: "item";
  readonly item: string;
  readonly holder: string;
}

export interface ThreadAssertion extends CommonFields {
  readonly kind: "thread";
  readonly thread: string;
  readonly status: ThreadStatus;
}

export interface WorldRuleAssertion extends CommonFields {
  readonly kind: "world_rule";
  readonly topic: string;
}

export interface TimelineAssertion extends CommonFields {
  readonly kind: "timeline";
  readonly sequence: readonly string[];
}

export interface LexiconAssertion extends CommonFields {
  readonly kind: "lexicon";
  readonly term: string;
  readonly lockedSpelling: boolean;
}

export interface StyleAssertion extends CommonFields {
  readonly kind: "style";
  readonly field: string;
  readonly value: string;
}

export type Assertion =
  | CharacterAssertion
  | AppearanceAssertion
  | RelationshipAssertion
  | ItemAssertion
  | ThreadAssertion
  | WorldRuleAssertion
  | TimelineAssertion
  | LexiconAssertion
  | StyleAssertion;

export interface AssertionSet {
  readonly book: string;
  readonly assertions: readonly Assertion[];
}

export type ValidationIssueCode =
  | "E_SCHEMA"
  | "E_BOOK_MISMATCH"
  | "E_ID_DUPLICATE"
  | "E_EVIDENCE_REQUIRED"
  | "E_ORDINAL_OUT_OF_RANGE";

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly message: string;
}

export type ValidationResult =
  | { ok: true; set: AssertionSet }
  | { ok: false; errors: ValidationIssue[] };

export interface ValidationContext {
  /** Book id the set is loaded for; checked against the `book` field. */
  readonly bookId: string;
  /** Final chapter ordinal; enables as_of/evidence range checks when given. */
  readonly maxOrdinal?: number;
}

const TOP_LEVEL_KEYS = ["book", "assertions"] as const;
const EXPECTATIONS: readonly Expectation[] = ["must", "must_not"];

/** Wire-format payload keys each kind requires (snake_case per TESTING.md §5). */
const KIND_FIELD_NAMES: Record<AssertionKind, readonly string[]> = {
  character: ["name"],
  appearance: ["character", "attribute", "contains"],
  relationship: ["from", "to", "type"],
  item: ["item", "holder"],
  thread: ["thread", "status"],
  world_rule: ["topic"],
  timeline: ["sequence"],
  lexicon: ["term", "locked_spelling"],
  style: ["field", "value"],
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function ordinalList(value: unknown): number[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every(positiveInt)
    ? [...value]
    : undefined;
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmptyString)
    ? [...value]
    : undefined;
}

interface EntryParse {
  assertion?: Assertion;
  idForDupCheck?: string;
}

type Fail = (code: ValidationIssueCode, message: string) => void;

export function validateAssertionSet(raw: unknown, ctx: ValidationContext): ValidationResult {
  const errors: ValidationIssue[] = [];
  const fail: Fail = (code, message) => {
    errors.push({ code, message });
  };

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: [{ code: "E_SCHEMA", message: "assertions root must be a JSON/YAML object" }],
    };
  }

  checkTopLevelKeys(raw, fail);

  if (!nonEmptyString(raw.book)) {
    fail("E_SCHEMA", '"book" must be a non-empty string');
  } else if (raw.book !== ctx.bookId) {
    fail(
      "E_BOOK_MISMATCH",
      `"book" is "${raw.book}" but assertions are being validated for "${ctx.bookId}"`,
    );
  }

  if (!Array.isArray(raw.assertions) || raw.assertions.length === 0) {
    fail("E_SCHEMA", '"assertions" must be a non-empty array of assertion objects');
    return { ok: false, errors };
  }

  const assertions: Assertion[] = [];
  const idFirstSeen = new Map<string, number>();

  raw.assertions.forEach((entry, index) => {
    const parsed = parseEntry(entry, index, ctx, fail);
    if (parsed.idForDupCheck !== undefined) {
      const first = idFirstSeen.get(parsed.idForDupCheck);
      if (first === undefined) {
        idFirstSeen.set(parsed.idForDupCheck, index);
      } else {
        fail(
          "E_ID_DUPLICATE",
          `assertions[${index}]: id "${parsed.idForDupCheck}" already used by assertions[${first}]`,
        );
      }
    }
    if (parsed.assertion) {
      assertions.push(parsed.assertion);
    }
  });

  if (errors.length > 0 || assertions.length !== raw.assertions.length) {
    return { ok: false, errors };
  }

  return { ok: true, set: { book: ctx.bookId, assertions } };
}

function checkTopLevelKeys(raw: Record<string, unknown>, fail: Fail): void {
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.includes(key as (typeof TOP_LEVEL_KEYS)[number])) {
      fail("E_SCHEMA", `unexpected key "${key}"; expected one of ${TOP_LEVEL_KEYS.join(", ")}`);
    }
  }
}

function parseEntry(
  entry: unknown,
  index: number,
  ctx: ValidationContext,
  fail: Fail,
): EntryParse {
  const where = `assertions[${index}]`;
  if (!isPlainObject(entry)) {
    fail("E_SCHEMA", `${where} must be an object`);
    return {};
  }

  let valid = true;
  const requireString = (key: string): string => {
    const value = entry[key];
    if (!nonEmptyString(value)) {
      fail("E_SCHEMA", `${where}: "${key}" must be a non-empty string`);
      valid = false;
      return "";
    }
    return value;
  };

  const id = requireString("id");
  const idForDupCheck = SLUG_PATTERN.test(id) ? id : undefined;
  if (idForDupCheck === undefined) {
    fail("E_SCHEMA", `${where}: "id" must be a lowercase slug (letters, digits, dashes)`);
    valid = false;
  }

  const expectRaw = entry.expect;
  const expect: Expectation | undefined =
    expectRaw === "must" || expectRaw === "must_not" ? expectRaw : undefined;
  if (expect === undefined) {
    fail("E_SCHEMA", `${where}: "expect" must be one of ${EXPECTATIONS.join(", ")}`);
    valid = false;
  }

  const kindRaw = entry.kind;
  if (
    typeof kindRaw !== "string" ||
    !ASSERTION_KINDS.includes(kindRaw as AssertionKind)
  ) {
    fail(
      "E_SCHEMA",
      `${where}: "kind" must be one of ${ASSERTION_KINDS.join(", ")} (got ${JSON.stringify(kindRaw ?? null)})`,
    );
    return { idForDupCheck };
  }
  const kind = kindRaw as AssertionKind;

  checkUnknownPayloadKeys(entry, kind, where, fail);

  const asOf = entry.as_of;
  const limit = ctx.maxOrdinal;
  if (asOf !== undefined && !positiveInt(asOf)) {
    fail("E_SCHEMA", `${where}: "as_of" must be an integer >= 1`);
    valid = false;
  } else if (limit !== undefined && positiveInt(asOf) && asOf > limit) {
    fail(
      "E_ORDINAL_OUT_OF_RANGE",
      `${where}: "as_of" ${asOf} exceeds the book's final ordinal (${limit})`,
    );
    valid = false;
  }

  let evidence: number[];
  const rawEvidence = entry.evidence;
  if (rawEvidence === undefined) {
    if (expect === "must") {
      fail(
        "E_EVIDENCE_REQUIRED",
        `${where} (${id}): every "must" assertion must cite evidence chapter ordinals`,
      );
      valid = false;
    }
    evidence = [];
  } else {
    const ordinals = ordinalList(rawEvidence);
    if (ordinals === undefined) {
      fail(
        "E_SCHEMA",
        `${where}: "evidence" must be a non-empty array of positive integer ordinals`,
      );
      valid = false;
      evidence = [];
    } else {
      evidence = ordinals;
      if (limit !== undefined) {
        const beyond = ordinals.filter((ordinal) => ordinal > limit);
        if (beyond.length > 0) {
          fail(
            "E_ORDINAL_OUT_OF_RANGE",
            `${where}: evidence ordinals ${beyond.join(", ")} exceed the book's final ordinal (${limit})`,
          );
          valid = false;
        }
      }
    }
  }

  const note = entry.note;
  if (note !== undefined && !nonEmptyString(note)) {
    fail("E_SCHEMA", `${where}: "note" must be a non-empty string`);
    valid = false;
  }

  if (!valid || expect === undefined) {
    return { idForDupCheck };
  }

  const common = {
    id,
    expect,
    ...(positiveInt(asOf) ? { asOf } : {}),
    evidence,
    ...(nonEmptyString(note) ? { note } : {}),
  };

  const assertion = buildAssertion(common, entry, kind, where, fail);
  if (assertion === undefined) {
    return { idForDupCheck };
  }

  return { idForDupCheck: id, assertion };
}

function checkUnknownPayloadKeys(
  entry: Record<string, unknown>,
  kind: AssertionKind,
  where: string,
  fail: Fail,
): void {
  const allowed = new Set(["id", "kind", "expect", "as_of", "evidence", "note"]);
  for (const field of KIND_FIELD_NAMES[kind]) {
    allowed.add(field);
  }
  for (const key of Object.keys(entry)) {
    if (!allowed.has(key)) {
      fail("E_SCHEMA", `${where}: unexpected key "${key}" for kind "${kind}"`);
    }
  }
}

type Common = Pick<
  Assertion,
  "id" | "expect" | "asOf" | "evidence" | "note"
>;

function buildAssertion(
  common: Common,
  entry: Record<string, unknown>,
  kind: AssertionKind,
  where: string,
  fail: Fail,
): Assertion | undefined {
  switch (kind) {
    case "character": {
      const name = entry.name;
      if (!nonEmptyString(name)) {
        failMissing(where, ["name"], entry, fail);
        return undefined;
      }
      return { ...common, kind, name };
    }
    case "appearance": {
      const character = entry.character;
      const attribute = entry.attribute;
      const contains = entry.contains;
      if (!nonEmptyString(character) || !nonEmptyString(attribute) || !nonEmptyString(contains)) {
        failMissing(where, ["character", "attribute", "contains"], entry, fail);
        return undefined;
      }
      return { ...common, kind, character, attribute, contains };
    }
    case "relationship": {
      const from = entry.from;
      const to = entry.to;
      const relationType = entry.type;
      if (!nonEmptyString(from) || !nonEmptyString(to) || !nonEmptyString(relationType)) {
        failMissing(where, ["from", "to", "type"], entry, fail);
        return undefined;
      }
      return { ...common, kind, from, to, relationType };
    }
    case "item": {
      const item = entry.item;
      const holder = entry.holder;
      if (!nonEmptyString(item) || !nonEmptyString(holder)) {
        failMissing(where, ["item", "holder"], entry, fail);
        return undefined;
      }
      return { ...common, kind, item, holder };
    }
    case "thread": {
      const thread = entry.thread;
      if (!nonEmptyString(thread)) {
        failMissing(where, ["thread"], entry, fail);
        return undefined;
      }
      const status = entry.status;
      if (!isThreadStatus(status)) {
        fail(
          "E_SCHEMA",
          `${where}: "status" must be one of ${THREAD_STATUSES.join(", ")} (got ${JSON.stringify(status ?? null)})`,
        );
        return undefined;
      }
      return { ...common, kind, thread, status };
    }
    case "world_rule": {
      const topic = entry.topic;
      if (!nonEmptyString(topic)) {
        failMissing(where, ["topic"], entry, fail);
        return undefined;
      }
      return { ...common, kind, topic };
    }
    case "timeline": {
      const sequence = stringList(entry.sequence);
      if (sequence === undefined || sequence.length < 2) {
        fail(
          "E_SCHEMA",
          `${where}: "sequence" must be an array of at least two non-empty event names in story order`,
        );
        return undefined;
      }
      return { ...common, kind, sequence };
    }
    case "lexicon": {
      const term = entry.term;
      if (!nonEmptyString(term)) {
        failMissing(where, ["term"], entry, fail);
        return undefined;
      }
      const lockedSpelling = entry.locked_spelling;
      if (typeof lockedSpelling !== "boolean") {
        fail("E_SCHEMA", `${where}: "locked_spelling" must be a boolean`);
        return undefined;
      }
      return { ...common, kind, term, lockedSpelling };
    }
    case "style": {
      const field = entry.field;
      const value = entry.value;
      if (!nonEmptyString(field) || !nonEmptyString(value)) {
        failMissing(where, ["field", "value"], entry, fail);
        return undefined;
      }
      return { ...common, kind, field, value };
    }
  }
}

function isThreadStatus(value: unknown): value is ThreadStatus {
  return typeof value === "string" && (THREAD_STATUSES as readonly string[]).includes(value);
}

function failMissing(
  where: string,
  fields: readonly string[],
  entry: Record<string, unknown>,
  fail: Fail,
): void {
  const missing = fields.filter((field) => !nonEmptyString(entry[field]));
  const named = missing.map((field) => `"${field}"`).join(", ");
  const plural = missing.length === 1 ? "" : "s";
  fail(
    "E_SCHEMA",
    `${where}: ${named} must be a non-empty string${plural} for this assertion kind`,
  );
}
