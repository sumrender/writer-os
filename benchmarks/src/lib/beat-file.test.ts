import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadBeatSet } from "./beat-file.js";

let root: string;
let bookDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bench-beats-"));
  bookDir = join(root, "mini-book");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const BEATS_YML = `book: mini-book
chapters:
  - ordinal: 4
    beats:
      must_include:
        - "the brass compass passes to Joren Vey"
      must_not_include:
        - "Mara Vey and Joren Vey are revealed as sisters"
`;

describe("loadBeatSet", () => {
  it("returns an empty ok result when beats.yml is absent", () => {
    const result = loadBeatSet(bookDir, { maxOrdinal: 4 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.set.chapters).toEqual([]);
  });

  it("loads and validates a well-formed beats.yml", () => {
    mkdirSync(bookDir, { recursive: true });
    writeFileSync(join(bookDir, "beats.yml"), BEATS_YML);

    const result = loadBeatSet(bookDir, { maxOrdinal: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.set.book).toBe("mini-book");
    expect(result.set.chapters).toEqual([
      {
        ordinal: 4,
        mustInclude: ["the brass compass passes to Joren Vey"],
        mustNotInclude: ["Mara Vey and Joren Vey are revealed as sisters"],
      },
    ]);
  });

  it("reports invalid YAML with the parser's reason", () => {
    mkdirSync(bookDir, { recursive: true });
    writeFileSync(join(bookDir, "beats.yml"), "book: mini-book\nchapters: [unclosed");

    const result = loadBeatSet(bookDir, { maxOrdinal: 4 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("E_BEATS_PARSE");
    expect(result.errors[0]?.message).toContain("beats.yml");
  });

  it("propagates schema validation errors", () => {
    mkdirSync(bookDir, { recursive: true });
    writeFileSync(join(bookDir, "beats.yml"), "book: mini-book\nchapters: []\n");

    const result = loadBeatSet(bookDir, { maxOrdinal: 4 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe("E_SCHEMA");
  });
});
