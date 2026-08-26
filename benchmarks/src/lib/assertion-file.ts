import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";
import {
  validateAssertionSet,
  type AssertionSet,
  type ValidationIssueCode,
} from "./assertions.js";

export type AssertionFileErrorCode =
  | "E_ASSERTION_FILE_MISSING"
  | "E_ASSERTIONS_PARSE";

export interface LoadedAssertionIssue {
  readonly code: ValidationIssueCode | AssertionFileErrorCode;
  readonly message: string;
}

export type LoadedAssertions =
  | { ok: true; set: AssertionSet }
  | { ok: false; errors: LoadedAssertionIssue[] };

const ASSERTIONS_FILE = "assertions.yml";

/**
 * Reads and validates a book's assertions.yml. The book id is derived from
 * the directory name, mirroring manifest validation.
 */
export function loadAssertionSet(
  bookDir: string,
  limits: { maxOrdinal?: number } = {},
): LoadedAssertions {
  const bookId = basename(bookDir);
  const filePath = join(bookDir, ASSERTIONS_FILE);

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return {
      ok: false,
      errors: [
        {
          code: "E_ASSERTION_FILE_MISSING",
          message: `${bookId}/${ASSERTIONS_FILE}: assertion set not found`,
        },
      ],
    };
  }

  let raw: unknown;
  try {
    raw = parse(readFileSync(filePath, "utf8"));
  } catch (cause) {
    return {
      ok: false,
      errors: [
        {
          code: "E_ASSERTIONS_PARSE",
          message: `${bookId}/${ASSERTIONS_FILE}: invalid YAML (${
            cause instanceof Error ? cause.message.split("\n")[0] : String(cause)
          })`,
        },
      ],
    };
  }

  const result = validateAssertionSet(raw, { bookId, ...limits });
  if (result.ok) {
    return result;
  }
  return { ok: false, errors: result.errors };
}
