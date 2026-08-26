import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { parse } from "yaml";
import { maxOrdinal as maxOrdinalOf, type ValidatedChapter } from "./manifest.js";
import {
  validatePerturbationEntry,
  type PerturbationSetEntry,
  type ValidationIssueCode as PerturbationIssueCode,
} from "./perturbation.js";

/**
 * Loads and validates a book's `perturbations/` directory (docs/TESTING.md
 * §7): each `.yml` file is one perturbation or control entry, cross-checked
 * against the book's assertion ids and resolved to its chapter text — the
 * edited `.txt` file for perturbations, the book's own chapter for controls.
 * A book with no `perturbations/` directory loads as an empty, valid set:
 * authoring real hand-edited fixtures stays a documented human task.
 */

export type PerturbationFileErrorCode =
  | PerturbationIssueCode
  | "E_PERTURBATIONS_PARSE"
  | "E_CHAPTER_FILE_MISSING"
  | "E_FILE_TRAVERSAL"
  | "E_ID_DUPLICATE";

export interface LoadedPerturbationIssue {
  readonly code: PerturbationFileErrorCode;
  readonly message: string;
}

export interface PerturbationCase {
  readonly entry: PerturbationSetEntry;
  readonly chapterText: string;
}

export type LoadedPerturbationSet =
  | { ok: true; cases: readonly PerturbationCase[] }
  | { ok: false; errors: readonly LoadedPerturbationIssue[] };

const PERTURBATIONS_DIR = "perturbations";

export function loadPerturbationSet(
  bookDir: string,
  chapters: readonly ValidatedChapter[],
  assertionIds?: ReadonlySet<string>,
): LoadedPerturbationSet {
  const bookId = basename(bookDir);
  const dir = join(bookDir, PERTURBATIONS_DIR);

  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { ok: true, cases: [] };
  }

  const maxOrdinal = maxOrdinalOf(chapters);
  const chaptersByOrdinal = new Map(chapters.map((c) => [c.ordinal, c]));

  const errors: LoadedPerturbationIssue[] = [];
  const cases: PerturbationCase[] = [];
  const idFirstSeen = new Map<string, string>();

  const fileNames = readdirSync(dir)
    .filter((name) => name.endsWith(".yml"))
    .sort();

  for (const fileName of fileNames) {
    const filePath = join(dir, fileName);
    let raw: unknown;
    try {
      raw = parse(readFileSync(filePath, "utf8"));
    } catch (cause) {
      errors.push({
        code: "E_PERTURBATIONS_PARSE",
        message: `${bookId}/${PERTURBATIONS_DIR}/${fileName}: invalid YAML (${
          cause instanceof Error ? cause.message.split("\n")[0] : String(cause)
        })`,
      });
      continue;
    }

    const result = validatePerturbationEntry(raw, { bookId, maxOrdinal, assertionIds });
    if (!result.ok) {
      for (const issue of result.errors) {
        errors.push({
          code: issue.code,
          message: `${bookId}/${PERTURBATIONS_DIR}/${fileName}: ${issue.message}`,
        });
      }
      continue;
    }

    const first = idFirstSeen.get(result.entry.id);
    if (first !== undefined) {
      errors.push({
        code: "E_ID_DUPLICATE",
        message: `${bookId}/${PERTURBATIONS_DIR}/${fileName}: id "${result.entry.id}" already used by ${first}`,
      });
      continue;
    }
    idFirstSeen.set(result.entry.id, fileName);

    const chapterText = resolveChapterText(
      result.entry,
      bookDir,
      bookId,
      chaptersByOrdinal,
      errors,
    );
    if (chapterText !== undefined) {
      cases.push({ entry: result.entry, chapterText });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, cases };
}

function resolveChapterText(
  entry: PerturbationSetEntry,
  bookDir: string,
  bookId: string,
  chaptersByOrdinal: ReadonlyMap<number, ValidatedChapter>,
  errors: LoadedPerturbationIssue[],
): string | undefined {
  if (entry.kind === "control") {
    const chapter = chaptersByOrdinal.get(entry.baseOrdinal);
    if (chapter === undefined) {
      errors.push({
        code: "E_CHAPTER_FILE_MISSING",
        message: `${bookId}/${PERTURBATIONS_DIR}: control "${entry.id}" base_ordinal ${entry.baseOrdinal} has no matching chapter`,
      });
      return undefined;
    }
    return chapter.text;
  }

  const absolute = resolve(bookDir, entry.file);
  if (absolute !== bookDir && !absolute.startsWith(bookDir + sep)) {
    errors.push({
      code: "E_FILE_TRAVERSAL",
      message: `${bookId}/${PERTURBATIONS_DIR}: perturbation "${entry.id}" file "${entry.file}" escapes the book directory`,
    });
    return undefined;
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    errors.push({
      code: "E_CHAPTER_FILE_MISSING",
      message: `${bookId}/${entry.file}: edited chapter file not found (perturbation "${entry.id}")`,
    });
    return undefined;
  }
  return readFileSync(absolute, "utf8");
}
