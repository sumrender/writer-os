import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateBook, type BookManifest } from "./manifest.js";
import { chapterFileName } from "./chapter-file.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bench-manifest-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeBook(
  id: string,
  manifest: unknown,
  files: Record<string, string>,
): string {
  const bookDir = join(root, id);
  mkdirSync(bookDir, { recursive: true });
  if (manifest !== null) {
    writeFileSync(
      join(bookDir, "manifest.json"),
      typeof manifest === "string" ? manifest : JSON.stringify(manifest, null, 2),
    );
  }
  for (const [relPath, text] of Object.entries(files)) {
    const abs = join(bookDir, relPath);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, text);
  }
  return bookDir;
}

function manifestWith(chapterOrdinals: number[], overrides: Partial<BookManifest> = {}): BookManifest {
  return {
    book: "test-book",
    title: "Test Book",
    source: "Project Gutenberg #1",
    chapters: chapterOrdinals.map((ordinal) => ({
      ordinal,
      file: chapterFileName(ordinal),
      label: `CHAPTER ${ordinal}`,
    })),
    ...overrides,
  };
}

function validFiles(ordinals: number[]): Record<string, string> {
  return Object.fromEntries(
    ordinals.map((ordinal) => [chapterFileName(ordinal), `Chapter ${ordinal} prose.\n`]),
  );
}

const codesOf = (result: ReturnType<typeof validateBook>) =>
  result.ok ? [] : result.errors.map((e) => e.code);

describe("validateBook", () => {
  it("accepts a well-formed fixture book and returns chapters in ordinal order", () => {
    const dir = writeBook("test-book", manifestWith([1, 2, 3]), validFiles([1, 2, 3]));
    const result = validateBook(dir);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.book).toBe("test-book");
      expect(result.chapters.map((c) => c.ordinal)).toEqual([1, 2, 3]);
      expect(result.chapters[0]?.text).toContain("Chapter 1 prose.");
      expect(result.chapters[0]?.label).toBe("CHAPTER 1");
    }
  });

  it("rejects a missing manifest.json precisely", () => {
    const dir = join(root, "no-manifest");
    mkdirSync(dir, { recursive: true });
    const result = validateBook(dir);
    expect(codesOf(result)).toEqual(["E_MANIFEST_MISSING"]);
    if (!result.ok) {
      expect(result.errors[0]!.message).toContain("no-manifest/manifest.json");
    }
  });

  it("rejects malformed JSON with the parse reason", () => {
    const dir = writeBook("test-book", "not json", {});
    const result = validateBook(dir);
    expect(codesOf(result)).toEqual(["E_JSON_PARSE"]);
    if (!result.ok) expect(result.errors[0]!.message).toMatch(/Unexpected token/i);
  });

  it("rejects unknown top-level keys", () => {
    const dir = writeBook("test-book", { ...manifestWith([1]), chapterz: [] }, validFiles([1]));
    const result = validateBook(dir);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    if (!result.ok) expect(result.errors[0]!.message).toContain('unexpected key "chapterz"');
  });

  it("rejects a missing required top-level field", () => {
    const m = manifestWith([1]);
    delete (m as Partial<BookManifest>).title;
    const result = validateBook(writeBook("test-book", m, validFiles([1])));
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    if (!result.ok) expect(result.errors[0]!.message).toContain('"title"');
  });

  it("rejects an empty chapters array", () => {
    const result = validateBook(writeBook("test-book", manifestWith([]), {}));
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    if (!result.ok) expect(result.errors[0]!.message).toContain("empty");
  });

  it("rejects a chapter entry whose ordinal is not a positive integer", () => {
    const m = manifestWith([1]);
    (m.chapters[0] as { ordinal: number }).ordinal = 0;
    const result = validateBook(writeBook("test-book", m, validFiles([1])));
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    if (!result.ok) expect(result.errors[0]!.message).toContain("ordinal");
  });

  it("rejects a chapter entry with a non-string label or empty label", () => {
    const m = manifestWith([1]);
    (m.chapters[0] as { label: string }).label = "";
    const result = validateBook(writeBook("test-book", m, validFiles([1])));
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
  });

  it("rejects when the manifest book id does not match its directory name", () => {
    const dir = writeBook("actual-dir", manifestWith([1], { book: "other-name" }), validFiles([1]));
    const result = validateBook(dir);
    expect(codesOf(result)).toEqual(["E_SCHEMA"]);
    if (!result.ok) {
      expect(result.errors[0]!.message).toContain("other-name");
      expect(result.errors[0]!.message).toContain("actual-dir");
    }
  });

  it("enforces ordinals contiguous from 1: flags a gap with the expected ordinal", () => {
    const dir = writeBook("test-book", manifestWith([1, 2, 4]), validFiles([1, 2, 4]));
    const result = validateBook(dir);
    expect(codesOf(result)).toEqual(["E_ORDINAL_SEQUENCE"]);
    if (!result.ok) {
      expect(result.errors[0]!.message).toContain("expected ordinal 3");
      expect(result.errors[0]!.message).toContain("found 4");
    }
  });

  it("flags a manifest that does not start at ordinal 1", () => {
    const dir = writeBook("test-book", manifestWith([2, 3]), validFiles([2, 3]));
    const result = validateBook(dir);
    expect(codesOf(result)).toEqual(["E_ORDINAL_SEQUENCE"]);
    if (!result.ok) expect(result.errors[0]!.message).toContain("expected ordinal 1");
  });

  it("flags duplicate ordinals", () => {
    const m = manifestWith([1, 2, 2]);
    m.chapters[2]!.file = "source/ch03.txt";
    const files = { ...validFiles([1, 2]), "source/ch03.txt": "Three.\n" };
    const result = validateBook(writeBook("test-book", m, files));
    expect(codesOf(result)).toEqual(["E_ORDINAL_DUPLICATE"]);
    if (!result.ok) expect(result.errors[0]!.message).toContain("duplicate ordinal 2");
  });

  it("rejects a referenced chapter file that is missing, naming the path and ordinal", () => {
    const dir = writeBook("test-book", manifestWith([1, 2]), validFiles([1]));
    const result = validateBook(dir);
    expect(codesOf(result)).toEqual(["E_FILE_MISSING"]);
    if (!result.ok) {
      expect(result.errors[0]!.message).toContain("ordinal 2");
      expect(result.errors[0]!.message).toContain("test-book/source/ch02.txt");
    }
  });

  it("catches misnamed chapter files: manifest misses the real file and lists it unreferenced", () => {
    const m = manifestWith([1]);
    m.chapters[0]!.file = "source/ch01.txt";
    const dir = writeBook("test-book", m, { "source/ch1.txt": "splitter used the wrong name.\n" });
    const result = validateBook(dir);
    expect(codesOf(result).sort()).toEqual(["E_FILE_MISSING", "E_FILE_UNREFERENCED"]);
    if (!result.ok) {
      expect(result.errors.map((e) => e.message).join("\n")).toContain("source/ch01.txt");
      expect(result.errors.map((e) => e.message).join("\n")).toContain("ch1.txt");
    }
  });

  it("rejects an empty chapter file", () => {
    const files = validFiles([1]);
    files["source/ch01.txt"] = "   \n\n";
    const result = validateBook(writeBook("test-book", manifestWith([1]), files));
    expect(codesOf(result)).toEqual(["E_FILE_EMPTY"]);
  });

  it("rejects paths that escape the book directory", () => {
    const m = manifestWith([1]);
    m.chapters[0]!.file = "../outside.txt";
    const result = validateBook(writeBook("test-book", m, {}));
    expect(codesOf(result)).toEqual(["E_FILE_TRAVERSAL"]);
  });

  it("aggregates every problem in one pass instead of failing fast", () => {
    const m = manifestWith([1, 2, 5], { title: undefined as unknown as string });
    const dir = writeBook("test-book", m, validFiles([1]));
    const result = validateBook(dir);
    const codes = codesOf(result);
    expect(codes).toContain("E_SCHEMA");
    expect(codes).toContain("E_ORDINAL_SEQUENCE");
    expect(codes).toContain("E_FILE_MISSING");
  });

  it("keeps checking entries after an invalid entry", () => {
    const m = manifestWith([1, 2, 3]);
    (m.chapters[1] as { ordinal: number }).ordinal = 0;
    const result = validateBook(
      writeBook("test-book", m, validFiles([1, 2, 3])),
    );
    const codes = codesOf(result);
    expect(codes).toContain("E_SCHEMA");
    expect(codes).toContain("E_ORDINAL_SEQUENCE");
    expect(codes).toContain("E_FILE_UNREFERENCED");
  });
});
