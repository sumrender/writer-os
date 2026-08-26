import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_NOT_IMPLEMENTED, EXIT_OK, EXIT_USAGE, EXIT_VALIDATION_FAILED, runCli, type CliIo } from "./runner.js";
import { chapterFileName } from "./lib/chapter-file.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bench-runner-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeBook(id: string, ordinals: number[]): string {
  const bookDir = join(root, id);
  mkdirSync(join(bookDir, "source"), { recursive: true });
  const chapters = ordinals.map((ordinal) => ({
    ordinal,
    file: chapterFileName(ordinal),
    label: `CHAPTER ${ordinal}`,
  }));
  writeFileSync(join(bookDir, "manifest.json"), JSON.stringify({ book: id, title: `Title of ${id}`, source: "Project Gutenberg #1", chapters }, null, 2));
  for (const chapter of chapters) {
    writeFileSync(join(bookDir, chapter.file), `${chapter.label} prose.\n`);
  }
  return bookDir;
}

function corrupt(bookId: string, mutate: (bookDir: string) => void): string {
  const dir = writeBook(bookId, [1, 2, 3]);
  mutate(dir);
  return dir;
}

interface Output {
  out: string[];
  err: string[];
  text: string;
}

function capture(): CliIo & Output {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    get text() {
      return [...out, ...err].join("\n");
    },
    out,
    err,
  };
}

function run(argv: string[], io: CliIo & Output): number {
  return runCli(argv, io, { booksRoot: root });
}

describe("runCli", () => {
  it("validates a healthy fixture book and exits 0 with a summary", () => {
    writeBook("tom-sawyer", [1, 2, 3]);
    const io = capture();
    expect(run(["validate", "--book", "tom-sawyer"], io)).toBe(EXIT_OK);
    expect(io.out.join("\n")).toContain("tom-sawyer");
    expect(io.out.join("\n")).toContain("3");
  });

  it("exits 1 with precise errors for a deliberately corrupted fixture", () => {
    corrupt("tom-sawyer", (dir) => rmSync(join(dir, "source", "ch02.txt")));
    const io = capture();
    expect(run(["validate", "--book", "tom-sawyer"], io)).toBe(EXIT_VALIDATION_FAILED);
    expect(io.err.join("\n")).toContain("E_FILE_MISSING");
    expect(io.err.join("\n")).toContain("ch02.txt");
    expect(io.err.join("\n")).toContain("ordinal 2");
  });

  it("flags an ordinal gap precisely through the CLI", () => {
    writeBook("gapped", [1, 3]);
    const io = capture();
    expect(run(["validate", "--book", "gapped"], io)).toBe(EXIT_VALIDATION_FAILED);
    expect(io.err.join("\n")).toContain("expected ordinal 2, found 3");
  });

  it("treats an unknown book id as a validation failure naming the manifest", () => {
    const io = capture();
    expect(run(["validate", "--book", "nope"], io)).toBe(EXIT_VALIDATION_FAILED);
    expect(io.err.join("\n")).toContain("nope/manifest.json");
  });

  it("accepts a --books-root override", () => {
    writeBook("elsewhere", [1]);
    const io = capture();
    const silent: CliIo = { stdout: () => {}, stderr: () => {} };
    expect(runCli(["validate", "--book", "elsewhere", "--books-root", root], io)).toBe(EXIT_OK);
    expect(runCli(["validate", "--book", "elsewhere"], silent)).not.toBe(EXIT_OK);
  });

  it("`run` validates first, then reports the axis as not implemented (exit 3)", () => {
    writeBook("tom-sawyer", [1, 2]);
    const io = capture();
    expect(run(["run", "--book", "tom-sawyer", "--axis", "extraction"], io)).toBe(
      EXIT_NOT_IMPLEMENTED,
    );
    expect(io.text).toContain("not implemented");
    expect(io.out.join("\n")).toContain("2");
  });

  it("`run` still fails validation-first when the fixture is broken", () => {
    corrupt("broken-book", (dir) => rmSync(join(dir, "source", "ch02.txt")));
    const io = capture();
    expect(run(["run", "--book", "broken-book", "--axis", "extraction"], io)).toBe(
      EXIT_VALIDATION_FAILED,
    );
    expect(io.err.join("\n")).toContain("E_FILE_MISSING");
  });

  it("rejects an unknown axis as a usage error", () => {
    writeBook("ok", [1]);
    const io = capture();
    expect(run(["run", "--book", "ok", "--axis", "vibes"], io)).toBe(EXIT_USAGE);
    expect(io.err.join("\n")).toContain("--axis");
  });

  it("rejects missing required flags as a usage error", () => {
    const io = capture();
    expect(run(["run", "--axis", "extraction"], io)).toBe(EXIT_USAGE);
    expect(run(["validate"], io)).toBe(EXIT_USAGE);
  });

  it("rejects unknown commands as a usage error", () => {
    const io = capture();
    expect(run(["frobnicate"], io)).toBe(EXIT_USAGE);
    expect(io.err.join("\n")).toContain("usage");
  });

  it("prints usage for help", () => {
    const io = capture();
    expect(run(["help"], io)).toBe(EXIT_OK);
    expect(io.out.join("\n")).toContain("usage");
  });

  it("lists every book with its validity", () => {
    writeBook("good-book", [1, 2]);
    corrupt("bad-book", (dir) => rmSync(join(dir, "manifest.json")));
    const io = capture();
    expect(run(["list"], io)).toBe(EXIT_VALIDATION_FAILED);
    expect(io.out.join("\n")).toContain("good-book");
    expect(io.text).toContain("bad-book");
    expect(io.text).toContain("E_MANIFEST_MISSING");
  });
});
