import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { validateBeatSet, type BeatSet, type ValidationIssueCode } from "./beats.js";

/**
 * Reads and validates a book's beats.yml (docs/TESTING.md §8). A book with
 * no beats.yml loads as an empty, valid set: authoring beat declarations is
 * a documented human task that can wait until axis 3, mirroring the
 * perturbations directory's absent-is-valid convention.
 */

export type BeatFileErrorCode = ValidationIssueCode | "E_BEATS_PARSE";

export interface LoadedBeatIssue {
  readonly code: BeatFileErrorCode;
  readonly message: string;
}

export type LoadedBeats =
  | { ok: true; set: BeatSet }
  | { ok: false; errors: LoadedBeatIssue[] };

const BEATS_FILE = "beats.yml";

export function loadBeatSet(
  bookDir: string,
  limits: { maxOrdinal?: number } = {},
): LoadedBeats {
  const bookId = basename(bookDir);
  const filePath = join(bookDir, BEATS_FILE);

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return { ok: true, set: { book: bookId, chapters: [] } };
  }

  let raw: unknown;
  try {
    raw = parse(readFileSync(filePath, "utf8"));
  } catch (cause) {
    return {
      ok: false,
      errors: [
        {
          code: "E_BEATS_PARSE",
          message: `${bookId}/${BEATS_FILE}: invalid YAML (${
            cause instanceof Error ? cause.message.split("\n")[0] : String(cause)
          })`,
        },
      ],
    };
  }

  const result = validateBeatSet(raw, { bookId, ...limits });
  if (result.ok) {
    return result;
  }
  return { ok: false, errors: result.errors };
}
