import { isPlainObject, nonEmptyString, positiveInt } from "./schema-primitives.js";

/**
 * Beat-declaration schema (docs/TESTING.md §8): per-chapter required and
 * forbidden narrative events a faithful generation of chapter N+1 must
 * satisfy. Creative divergence is otherwise acceptable — only a missing
 * required beat or a stated contradiction fails grading. Wire format (YAML)
 * uses snake_case; this module validates that format and produces the typed
 * internal form, mirroring assertions.ts and perturbation.ts.
 */

export interface BeatChapter {
  readonly ordinal: number;
  readonly mustInclude: readonly string[];
  readonly mustNotInclude: readonly string[];
}

export interface BeatSet {
  readonly book: string;
  readonly chapters: readonly BeatChapter[];
}

export type ValidationIssueCode =
  | "E_SCHEMA"
  | "E_BOOK_MISMATCH"
  | "E_ORDINAL_DUPLICATE"
  | "E_ORDINAL_OUT_OF_RANGE";

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly message: string;
}

export type ValidationResult =
  | { ok: true; set: BeatSet }
  | { ok: false; errors: ValidationIssue[] };

export interface ValidationContext {
  /** Book id the set is loaded for; checked against the `book` field. */
  readonly bookId: string;
  /** Final chapter ordinal; enables ordinal range checks when given. */
  readonly maxOrdinal?: number;
}

const TOP_LEVEL_KEYS = ["book", "chapters"] as const;
const CHAPTER_KEYS = ["ordinal", "beats"] as const;
const BEATS_KEYS = ["must_include", "must_not_include"] as const;

type Fail = (code: ValidationIssueCode, message: string) => void;

export function validateBeatSet(raw: unknown, ctx: ValidationContext): ValidationResult {
  const errors: ValidationIssue[] = [];
  const fail: Fail = (code, message) => {
    errors.push({ code, message });
  };

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      errors: [{ code: "E_SCHEMA", message: "beats root must be a JSON/YAML object" }],
    };
  }

  checkKeys(raw, TOP_LEVEL_KEYS, "", fail);

  if (!nonEmptyString(raw.book)) {
    fail("E_SCHEMA", '"book" must be a non-empty string');
  } else if (raw.book !== ctx.bookId) {
    fail(
      "E_BOOK_MISMATCH",
      `"book" is "${raw.book}" but beats are being validated for "${ctx.bookId}"`,
    );
  }

  if (!Array.isArray(raw.chapters) || raw.chapters.length === 0) {
    fail("E_SCHEMA", '"chapters" must be a non-empty array of chapter beat declarations');
    return { ok: false, errors };
  }

  const chapters: BeatChapter[] = [];
  const ordinalFirstSeen = new Map<number, number>();

  raw.chapters.forEach((entry, index) => {
    const parsed = parseChapterEntry(entry, index, ctx, fail);
    if (parsed === undefined) return;

    const first = ordinalFirstSeen.get(parsed.ordinal);
    if (first === undefined) {
      ordinalFirstSeen.set(parsed.ordinal, index);
      chapters.push(parsed);
    } else {
      fail(
        "E_ORDINAL_DUPLICATE",
        `chapters[${index}]: ordinal ${parsed.ordinal} already used by chapters[${first}]`,
      );
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, set: { book: ctx.bookId, chapters } };
}

function checkKeys(
  raw: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  fail: Fail,
): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      fail("E_SCHEMA", `${where}unexpected key "${key}"; expected one of ${allowed.join(", ")}`);
    }
  }
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(nonEmptyString) ? [...value] : undefined;
}

function parseChapterEntry(
  entry: unknown,
  index: number,
  ctx: ValidationContext,
  fail: Fail,
): BeatChapter | undefined {
  const where = `chapters[${index}]`;
  if (!isPlainObject(entry)) {
    fail("E_SCHEMA", `${where} must be an object`);
    return undefined;
  }

  checkKeys(entry, CHAPTER_KEYS, `${where}: `, fail);

  const ordinal = entry.ordinal;
  let valid = true;
  if (!positiveInt(ordinal)) {
    fail("E_SCHEMA", `${where}: "ordinal" must be an integer >= 1`);
    valid = false;
  } else if (ctx.maxOrdinal !== undefined && ordinal > ctx.maxOrdinal) {
    fail(
      "E_ORDINAL_OUT_OF_RANGE",
      `${where}: ordinal ${ordinal} exceeds the book's final ordinal (${ctx.maxOrdinal})`,
    );
    valid = false;
  }

  const beatsRaw = entry.beats;
  if (!isPlainObject(beatsRaw)) {
    fail("E_SCHEMA", `${where}: "beats" must be an object`);
    return undefined;
  }
  checkKeys(beatsRaw, BEATS_KEYS, `${where}.beats: `, fail);

  let mustInclude: string[] = [];
  if (beatsRaw.must_include !== undefined) {
    const parsed = stringList(beatsRaw.must_include);
    if (parsed === undefined) {
      fail(`E_SCHEMA`, `${where}.beats: "must_include" must be an array of non-empty strings`);
      valid = false;
    } else {
      mustInclude = parsed;
    }
  }

  let mustNotInclude: string[] = [];
  if (beatsRaw.must_not_include !== undefined) {
    const parsed = stringList(beatsRaw.must_not_include);
    if (parsed === undefined) {
      fail(
        "E_SCHEMA",
        `${where}.beats: "must_not_include" must be an array of non-empty strings`,
      );
      valid = false;
    } else {
      mustNotInclude = parsed;
    }
  }

  if (valid && mustInclude.length === 0 && mustNotInclude.length === 0) {
    fail(
      "E_SCHEMA",
      `${where}.beats: must declare at least one of "must_include" or "must_not_include"`,
    );
    valid = false;
  }

  if (!valid || !positiveInt(ordinal)) {
    return undefined;
  }

  return { ordinal, mustInclude, mustNotInclude };
}
