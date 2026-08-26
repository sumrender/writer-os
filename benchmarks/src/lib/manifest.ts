import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

export interface ManifestChapter {
  ordinal: number;
  file: string;
  label: string;
}

export interface BookManifest {
  book: string;
  title: string;
  source: string;
  chapters: ManifestChapter[];
}

export type ValidationErrorCode =
  | "E_MANIFEST_MISSING"
  | "E_JSON_PARSE"
  | "E_SCHEMA"
  | "E_ORDINAL_DUPLICATE"
  | "E_ORDINAL_SEQUENCE"
  | "E_FILE_MISSING"
  | "E_FILE_EMPTY"
  | "E_FILE_UNREFERENCED"
  | "E_FILE_TRAVERSAL"
  | "E_FILE_DUPLICATE_REF";

export interface ValidationError {
  code: ValidationErrorCode;
  message: string;
}

export interface ValidatedChapter extends ManifestChapter {
  text: string;
}

export type ValidationResult =
  | { ok: true; bookDir: string; manifest: BookManifest; chapters: ValidatedChapter[] }
  | { ok: false; bookDir: string; errors: ValidationError[] };

const MANIFEST_NAME = "manifest.json";
const TOP_LEVEL_KEYS = ["book", "title", "source", "chapters"] as const;

export function validateBook(bookDir: string): ValidationResult {
  const id = basename(bookDir);
  const errors: ValidationError[] = [];
  const fail = (code: ValidationErrorCode, message: string) => {
    errors.push({ code, message });
  };

  const manifestPath = join(bookDir, MANIFEST_NAME);
  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      bookDir,
      errors: [
        {
          code: "E_MANIFEST_MISSING",
          message: `${id}/${MANIFEST_NAME}: manifest not found`,
        },
      ],
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (cause) {
    return {
      ok: false,
      bookDir,
      errors: [
        {
          code: "E_JSON_PARSE",
          message: `${id}/${MANIFEST_NAME}: invalid JSON (${
            cause instanceof Error ? cause.message : String(cause)
          })`,
        },
      ],
    };
  }

  const schemaProblems: string[] = [];
  const parsed = checkSchema(raw, id, schemaProblems);
  for (const problem of schemaProblems) {
    fail("E_SCHEMA", `${id}/${MANIFEST_NAME}: ${problem}`);
  }

  if (!parsed) {
    return { ok: false, bookDir, errors };
  }

  checkOrdinals(parsed.chapters, id, fail);

  const readable = checkFiles(bookDir, parsed.chapters, id, fail);
  checkUnreferencedSources(
    bookDir,
    parsed.chapters.map((c) => c.file),
    id,
    fail,
  );

  if (errors.length > 0 || !parsed.manifest) {
    return { ok: false, bookDir, errors };
  }

  return {
    ok: true,
    bookDir,
    manifest: parsed.manifest,
    chapters: [...readable].sort((a, b) => a.ordinal - b.ordinal),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}

function txtPath(value: unknown): string | undefined {
  return isNonEmptyString(value) && value.endsWith(".txt")
    ? normalizeRelPath(value)
    : undefined;
}

interface ParsedManifest {
  manifest?: BookManifest;
  chapters: ManifestChapter[];
}

function checkSchema(
  raw: unknown,
  bookId: string,
  problems: string[],
): ParsedManifest | undefined {
  if (!isPlainObject(raw)) {
    problems.push("manifest root must be a JSON object");
    return undefined;
  }

  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.includes(key as (typeof TOP_LEVEL_KEYS)[number])) {
      problems.push(
        `unexpected key "${key}"; expected one of ${TOP_LEVEL_KEYS.join(", ")}`,
      );
    }
  }

  const scalars: Partial<Record<"book" | "title" | "source", string>> = {};
  for (const key of ["book", "title", "source"] as const) {
    const value = raw[key];
    if (isNonEmptyString(value)) {
      scalars[key] = value;
    } else {
      problems.push(`"${key}" must be a non-empty string`);
    }
  }
  if (
    scalars.book !== undefined &&
    scalars.book !== bookId
  ) {
    problems.push(
      `"book" ("${scalars.book}") does not match directory name ("${bookId}")`,
    );
  }

  const chaptersRaw = raw.chapters;
  if (!Array.isArray(chaptersRaw) || chaptersRaw.length === 0) {
    problems.push('"chapters" must be a non-empty array');
    return undefined;
  }

  const chapters: ManifestChapter[] = [];

  chaptersRaw.forEach((entry, index) => {
    const where = `chapters[${index}]`;
    if (!isPlainObject(entry)) {
      problems.push(`${where} must be an object`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (key !== "ordinal" && key !== "file" && key !== "label") {
        problems.push(`${where}: unexpected key "${key}"`);
      }
    }

    const ordinal = positiveInt(entry.ordinal);
    if (ordinal === undefined) {
      problems.push(`${where}: "ordinal" must be an integer >= 1`);
    }

    const file = txtPath(entry.file);
    if (!isNonEmptyString(entry.file)) {
      problems.push(`${where}: "file" must be a non-empty string`);
    } else if (file === undefined) {
      problems.push(
        `${where}: "file" must reference a .txt file (got "${entry.file}")`,
      );
    }

    const label = isNonEmptyString(entry.label) ? entry.label : undefined;
    if (label === undefined) {
      problems.push(`${where}: "label" must be a non-empty string`);
    }

    if (ordinal !== undefined && file !== undefined && label !== undefined) {
      chapters.push({ ordinal, file, label });
    }
  });

  if (chapters.length === 0) {
    return undefined;
  }

  const { book, title, source } = scalars;
  const manifest =
    book !== undefined && title !== undefined && source !== undefined
      ? { book, title, source, chapters }
      : undefined;

  return { manifest, chapters };
}

function normalizeRelPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function checkOrdinals(
  chapters: ManifestChapter[],
  bookId: string,
  fail: (code: ValidationErrorCode, message: string) => void,
): void {
  const byOrdinal = new Map<number, number[]>();
  chapters.forEach((chapter, index) => {
    const hits = byOrdinal.get(chapter.ordinal) ?? [];
    hits.push(index + 1);
    byOrdinal.set(chapter.ordinal, hits);
  });

  for (const [ordinal, entries] of byOrdinal) {
    if (entries.length > 1) {
      fail(
        "E_ORDINAL_DUPLICATE",
        `${bookId}/manifest.json: duplicate ordinal ${ordinal} (entries ${entries.join(" and ")})`,
      );
    }
  }

  const sorted = [...byOrdinal.keys()].sort((a, b) => a - b);
  for (let expected = 1; expected <= sorted.length; expected++) {
    const found = sorted[expected - 1];
    if (found !== undefined && found !== expected) {
      fail(
        "E_ORDINAL_SEQUENCE",
        `${bookId}/manifest.json: ordinals must be contiguous from 1: expected ordinal ${expected}, found ${found}`,
      );
      return;
    }
  }
}

function checkFiles(
  bookDir: string,
  chapters: ManifestChapter[],
  bookId: string,
  fail: (code: ValidationErrorCode, message: string) => void,
): ValidatedChapter[] {
  const readable: ValidatedChapter[] = [];
  const seenFiles = new Map<string, number>();

  for (const chapter of chapters) {
    if (seenFiles.has(chapter.file)) {
      fail(
        "E_FILE_DUPLICATE_REF",
        `${bookId}/${chapter.file}: already referenced by ordinal ${seenFiles.get(chapter.file)} (duplicate reference from ordinal ${chapter.ordinal})`,
      );
      continue;
    }
    seenFiles.set(chapter.file, chapter.ordinal);

    const absolute = resolve(bookDir, chapter.file);
    if (absolute !== bookDir && !absolute.startsWith(bookDir + sep)) {
      fail(
        "E_FILE_TRAVERSAL",
        `${bookId}/manifest.json: chapter file "${chapter.file}" escapes the book directory`,
      );
      continue;
    }

    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      fail(
        "E_FILE_MISSING",
        `${bookId}/${chapter.file}: chapter file not found (referenced by ordinal ${chapter.ordinal})`,
      );
      continue;
    }

    const text = readFileSync(absolute, "utf8");
    if (text.trim().length === 0) {
      fail(
        "E_FILE_EMPTY",
        `${bookId}/${chapter.file}: chapter file is empty (ordinal ${chapter.ordinal})`,
      );
      continue;
    }

    readable.push({ ...chapter, text });
  }

  return readable;
}

function checkUnreferencedSources(
  bookDir: string,
  referencedFiles: string[],
  bookId: string,
  fail: (code: ValidationErrorCode, message: string) => void,
): void {
  const sourceDir = join(bookDir, "source");
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    return;
  }

  const referenced = new Set(referencedFiles);
  for (const name of readdirSync(sourceDir).sort()) {
    const relPath = `source/${name}`;
    if (name.endsWith(".txt") && !referenced.has(relPath)) {
      fail(
        "E_FILE_UNREFERENCED",
        `${bookId}/${relPath}: chapter file present but not referenced by manifest`,
      );
    }
  }
}
