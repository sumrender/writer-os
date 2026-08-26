import { isPlainObject, nonEmptyString, positiveInt, SLUG_PATTERN } from "./schema-primitives.js";

/**
 * Perturbation/control annotation schema (docs/TESTING.md §7): the checker
 * axis' ground truth. A perturbation entry describes a hand-edited copy of a
 * real chapter that must be flagged by the checker; a control entry names an
 * unmodified chapter that must not be. Both share `base_ordinal` (the
 * canon-state cutoff to check against) and `expect`; perturbation entries
 * additionally carry the edited chapter's file, human-written edit
 * descriptions, and the assertion ids the edits violate.
 *
 * This module validates shape only (no filesystem access, so no traversal
 * check here — `perturbation-file.ts` owns that against the real `bookDir`,
 * mirroring `manifest.ts`'s split between schema and file checks).
 */

export type PerturbationExpectation = "flag" | "no_flags";

interface CommonFields {
  readonly id: string;
  readonly baseOrdinal: number;
}

export interface PerturbationEdit {
  readonly description: string;
}

export interface PerturbationEntry extends CommonFields {
  readonly kind: "perturbation";
  readonly file: string;
  readonly edits: readonly PerturbationEdit[];
  readonly violates: readonly string[];
  readonly expect: "flag";
}

export interface ControlEntry extends CommonFields {
  readonly kind: "control";
  readonly expect: "no_flags";
}

export type PerturbationSetEntry = PerturbationEntry | ControlEntry;

export type ValidationIssueCode =
  | "E_SCHEMA"
  | "E_BASE_ORDINAL_OUT_OF_RANGE"
  | "E_VIOLATES_UNKNOWN_ID";

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly message: string;
}

export type ValidationResult =
  | { ok: true; entry: PerturbationSetEntry }
  | { ok: false; errors: ValidationIssue[] };

export interface ValidationContext {
  readonly bookId: string;
  /** Final chapter ordinal; enables base_ordinal range checks when given. */
  readonly maxOrdinal?: number;
  /** Known assertion ids in the book's set; enables violates cross-checks when given. */
  readonly assertionIds?: ReadonlySet<string>;
}

const KINDS = ["perturbation", "control"] as const;
type EntryKind = (typeof KINDS)[number];

const EXPECTATIONS: readonly PerturbationExpectation[] = ["flag", "no_flags"];

const PERTURBATION_ONLY_KEYS = ["file", "edits", "violates"] as const;
const COMMON_KEYS = ["kind", "id", "base_ordinal", "expect"] as const;

type Fail = (code: ValidationIssueCode, message: string) => void;

export function validatePerturbationEntry(
  raw: unknown,
  ctx: ValidationContext,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const fail: Fail = (code, message) => {
    errors.push({ code, message });
  };

  if (!isPlainObject(raw)) {
    return { ok: false, errors: [{ code: "E_SCHEMA", message: "entry root must be a JSON/YAML object" }] };
  }

  const kindRaw = raw.kind;
  if (typeof kindRaw !== "string" || !(KINDS as readonly string[]).includes(kindRaw)) {
    fail("E_SCHEMA", `"kind" must be one of ${KINDS.join(", ")} (got ${JSON.stringify(kindRaw ?? null)})`);
    return { ok: false, errors };
  }
  const kind = kindRaw as EntryKind;

  checkUnknownKeys(raw, kind, fail);

  const id = raw.id;
  if (!nonEmptyString(id)) {
    fail("E_SCHEMA", '"id" must be a non-empty string');
  } else if (!SLUG_PATTERN.test(id)) {
    fail("E_SCHEMA", '"id" must be a lowercase slug (letters, digits, dashes)');
  }

  const baseOrdinal = raw.base_ordinal;
  if (!positiveInt(baseOrdinal)) {
    fail("E_SCHEMA", '"base_ordinal" must be an integer >= 1');
  } else if (ctx.maxOrdinal !== undefined && baseOrdinal > ctx.maxOrdinal) {
    fail(
      "E_BASE_ORDINAL_OUT_OF_RANGE",
      `"base_ordinal" ${baseOrdinal} exceeds the book's final ordinal (${ctx.maxOrdinal})`,
    );
  }

  const expectRaw = raw.expect;
  const expect: PerturbationExpectation | undefined =
    typeof expectRaw === "string" && (EXPECTATIONS as readonly string[]).includes(expectRaw)
      ? (expectRaw as PerturbationExpectation)
      : undefined;
  if (expect === undefined) {
    fail("E_SCHEMA", `"expect" must be one of ${EXPECTATIONS.join(", ")}`);
  } else if (kind === "perturbation" && expect !== "flag") {
    fail("E_SCHEMA", '"expect" must be "flag" for a perturbation entry');
  } else if (kind === "control" && expect !== "no_flags") {
    fail("E_SCHEMA", '"expect" must be "no_flags" for a control entry');
  }

  if (kind === "control") {
    if (
      !nonEmptyString(id) ||
      !SLUG_PATTERN.test(id) ||
      !positiveInt(baseOrdinal) ||
      expect === undefined ||
      errors.length > 0
    ) {
      return { ok: false, errors };
    }
    return { ok: true, entry: { kind, id, baseOrdinal, expect: "no_flags" } };
  }

  const file = raw.file;
  if (!nonEmptyString(file)) {
    fail("E_SCHEMA", '"file" must be a non-empty string');
  } else if (!file.endsWith(".txt")) {
    fail("E_SCHEMA", `"file" must reference a .txt file (got "${file}")`);
  }

  const edits = parseEdits(raw.edits, fail);
  const violates = parseViolates(raw.violates, ctx.assertionIds, fail);

  if (
    !nonEmptyString(id) ||
    !SLUG_PATTERN.test(id) ||
    !positiveInt(baseOrdinal) ||
    expect === undefined ||
    !nonEmptyString(file) ||
    edits === undefined ||
    violates === undefined ||
    errors.length > 0
  ) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    entry: { kind, id, baseOrdinal, file, edits, violates, expect: "flag" },
  };
}

function checkUnknownKeys(raw: Record<string, unknown>, kind: EntryKind, fail: Fail): void {
  const allowed = new Set<string>(COMMON_KEYS);
  if (kind === "perturbation") {
    for (const key of PERTURBATION_ONLY_KEYS) allowed.add(key);
  }
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      fail("E_SCHEMA", `unexpected key "${key}"`);
    }
  }
}

function parseEdits(raw: unknown, fail: Fail): readonly PerturbationEdit[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail("E_SCHEMA", '"edits" must be a non-empty array of { description } objects');
    return undefined;
  }
  const edits: PerturbationEdit[] = [];
  let valid = true;
  raw.forEach((entry, index) => {
    if (!isPlainObject(entry) || !nonEmptyString(entry.description)) {
      fail("E_SCHEMA", `edits[${index}]: "description" must be a non-empty string`);
      valid = false;
      return;
    }
    edits.push({ description: entry.description });
  });
  return valid ? edits : undefined;
}

function parseViolates(
  raw: unknown,
  assertionIds: ReadonlySet<string> | undefined,
  fail: Fail,
): readonly string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(nonEmptyString)) {
    fail("E_SCHEMA", '"violates" must be a non-empty array of assertion id strings');
    return undefined;
  }
  const violates = [...raw];
  if (assertionIds !== undefined) {
    const unknown = violates.filter((id) => !assertionIds.has(id));
    if (unknown.length > 0) {
      fail(
        "E_VIOLATES_UNKNOWN_ID",
        `"violates" references unknown assertion id${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`,
      );
      return undefined;
    }
  }
  return violates;
}
