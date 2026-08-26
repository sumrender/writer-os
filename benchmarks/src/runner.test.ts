import { mkdirSync, mkdtempSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EXIT_GATE_FAILED,
  EXIT_NOT_IMPLEMENTED,
  EXIT_OK,
  EXIT_USAGE,
  EXIT_VALIDATION_FAILED,
  runCli,
  type CliIo,
} from "./runner.js";
import { chapterFileName } from "./lib/chapter-file.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bench-runner-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const REPO_BOOKS = join(dirname(fileURLToPath(import.meta.url)), "..", "books");

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

/** Installs the known-by-construction fixture so CLI extraction runs score offline. */
function installMiniBook(): void {
  cpSync(join(REPO_BOOKS, "mini-book"), join(root, "mini-book"), { recursive: true });
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

function run(
  argv: string[],
  io: CliIo & Output,
  extra: { judgeCachePath?: string; env?: Record<string, string> } = {},
): Promise<number> {
  const previousKey = process.env.AGNES_API_KEY;
  delete process.env.AGNES_API_KEY;
  if (extra.env?.AGNES_API_KEY !== undefined) process.env.AGNES_API_KEY = extra.env.AGNES_API_KEY;
  return runCli(argv, io, {
    booksRoot: root,
    judgeCachePath: extra.judgeCachePath ?? join(root, "cache.json"),
  }).finally(() => {
    if (previousKey === undefined) delete process.env.AGNES_API_KEY;
    else process.env.AGNES_API_KEY = previousKey;
  });
}

describe("runCli", () => {
  it("validates a healthy fixture book and exits 0 with a summary", async () => {
    writeBook("tom-sawyer", [1, 2, 3]);
    const io = capture();
    await expect(run(["validate", "--book", "tom-sawyer"], io)).resolves.toBe(EXIT_OK);
    expect(io.out.join("\n")).toContain("tom-sawyer");
    expect(io.out.join("\n")).toContain("3");
  });

  it("exits 1 with precise errors for a deliberately corrupted fixture", async () => {
    corrupt("tom-sawyer", (dir) => rmSync(join(dir, "source", "ch02.txt")));
    const io = capture();
    await expect(run(["validate", "--book", "tom-sawyer"], io)).resolves.toBe(
      EXIT_VALIDATION_FAILED,
    );
    expect(io.err.join("\n")).toContain("E_FILE_MISSING");
    expect(io.err.join("\n")).toContain("ch02.txt");
    expect(io.err.join("\n")).toContain("ordinal 2");
  });

  it("flags an ordinal gap precisely through the CLI", async () => {
    writeBook("gapped", [1, 3]);
    const io = capture();
    await expect(run(["validate", "--book", "gapped"], io)).resolves.toBe(EXIT_VALIDATION_FAILED);
    expect(io.err.join("\n")).toContain("expected ordinal 2, found 3");
  });

  it("treats an unknown book id as a validation failure naming the manifest", async () => {
    const io = capture();
    await expect(run(["validate", "--book", "nope"], io)).resolves.toBe(EXIT_VALIDATION_FAILED);
    expect(io.err.join("\n")).toContain("nope/manifest.json");
  });

  it("accepts a --books-root override", async () => {
    writeBook("elsewhere", [1]);
    const io = capture();
    const silent: CliIo = { stdout: () => {}, stderr: () => {} };
    await expect(
      runCli(["validate", "--book", "elsewhere", "--books-root", root], silent),
    ).resolves.toBe(EXIT_OK);
    await expect(runCli(["validate", "--book", "elsewhere"], silent)).resolves.not.toBe(EXIT_OK);
  });

  it("`run` validates first, then reports unimplemented axes (exit 3)", async () => {
    writeBook("tom-sawyer", [1, 2]);
    const io = capture();
    await expect(
      run(["run", "--book", "tom-sawyer", "--axis", "generation"], io),
    ).resolves.toBe(EXIT_NOT_IMPLEMENTED);
    expect(io.text).toContain("not implemented");
  });

  it("`run` still fails validation-first when the fixture is broken", async () => {
    corrupt("broken-book", (dir) => rmSync(join(dir, "source", "ch02.txt")));
    const io = capture();
    await expect(
      run(["run", "--book", "broken-book", "--axis", "generation"], io),
    ).resolves.toBe(EXIT_VALIDATION_FAILED);
    expect(io.err.join("\n")).toContain("E_FILE_MISSING");
  });

  it("rejects an unknown axis as a usage error", async () => {
    writeBook("ok", [1]);
    const io = capture();
    await expect(run(["run", "--book", "ok", "--axis", "vibes"], io)).resolves.toBe(EXIT_USAGE);
    expect(io.err.join("\n")).toContain("--axis");
  });

  it("rejects missing required flags as a usage error", async () => {
    const io = capture();
    await expect(run(["run", "--axis", "extraction"], io)).resolves.toBe(EXIT_USAGE);
    await expect(run(["validate"], io)).resolves.toBe(EXIT_USAGE);
  });

  it("rejects unknown commands as a usage error", async () => {
    const io = capture();
    await expect(run(["frobnicate"], io)).resolves.toBe(EXIT_USAGE);
    expect(io.err.join("\n")).toContain("usage");
  });

  it("prints usage for help", async () => {
    const io = capture();
    await expect(run(["help"], io)).resolves.toBe(EXIT_OK);
    expect(io.out.join("\n")).toContain("usage");
  });

  it("lists every book with its validity", async () => {
    writeBook("good-book", [1, 2]);
    corrupt("bad-book", (dir) => rmSync(join(dir, "manifest.json")));
    const io = capture();
    await expect(run(["list"], io)).resolves.toBe(EXIT_VALIDATION_FAILED);
    expect(io.out.join("\n")).toContain("good-book");
    expect(io.text).toContain("bad-book");
    expect(io.text).toContain("E_MANIFEST_MISSING");
  });
});

describe("runCli — extraction axis end-to-end (offline)", () => {
  it("runs the mini-book three times, prints the report, and exits 0", async () => {
    installMiniBook();
    const io = capture();

    await expect(run(["run", "--book", "mini-book", "--axis", "extraction"], io)).resolves.toBe(
      EXIT_OK,
    );

    const text = io.out.join("\n");
    expect(text).toContain("extraction — mini-book");
    expect(text).toContain("runs: 3");
    expect(text).toContain("precision 1.000");
    // The default stub judge scripts nothing, so the swept father-relationship
    // fact is judged unsupported — reported strictly as an estimate.
    expect(text).toContain("estimated fabrication rate 1.000");
    expect(text).toContain("gates: PASS");
  });

  it("writes the verdict cache only to the injected gitignored path", async () => {
    installMiniBook();
    const cachePath = join(root, "results", "cache", "judge-cache.json");
    const io = capture();

    await run(["run", "--book", "mini-book", "--axis", "extraction"], io, { judgeCachePath: cachePath });

    expect(existsSync(cachePath)).toBe(true);
    expect(existsSync(join(root, "mini-book", "results"))).toBe(false);
  });

  it("fails via exit code 4 when a recall gate misses", async () => {
    installMiniBook();
    const ch02 = join(root, "mini-book", "source", "ch02.txt");
    writeFileSync(
      ch02,
      readFileSync(ch02, "utf8")
        .split("\n")
        .filter((line) => !line.startsWith('Say always "Vess"'))
        .join("\n"),
    );
    const gatesPath = join(root, "gates.json");
    writeFileSync(gatesPath, JSON.stringify({ recall_min: { lexicon: 0.9 } }));
    const io = capture();

    await expect(
      run(["run", "--book", "mini-book", "--axis", "extraction", "--gates", gatesPath], io),
    ).resolves.toBe(EXIT_GATE_FAILED);

    expect(io.out.join("\n")).toContain("gates: FAIL");
    expect(io.out.join("\n")).toContain("recall.lexicon");
  });

  it("rejects an unreadable gates file as a usage error", async () => {
    installMiniBook();
    const gatesPath = join(root, "bad-gates.json");
    writeFileSync(gatesPath, '{"recall_min": {"wizards": 0.5}}');
    const io = capture();

    await expect(
      run(["run", "--book", "mini-book", "--axis", "extraction", "--gates", gatesPath], io),
    ).resolves.toBe(EXIT_USAGE);
    expect(io.err.join("\n")).toContain("wizards");
  });

  it("prints machine-readable JSON when --format json is given", async () => {
    installMiniBook();
    const io = capture();

    await expect(
      run(["run", "--book", "mini-book", "--axis", "extraction", "--format", "json"], io),
    ).resolves.toBe(EXIT_OK);

    const parsed = JSON.parse(io.out.join("\n")) as { passed: boolean; runs: number; axis: string };
    expect(parsed.passed).toBe(true);
    expect(parsed.runs).toBe(3);
    expect(parsed.axis).toBe("extraction");
  });

  it("honors --runs and rejects non-positive or non-numeric counts", async () => {
    installMiniBook();
    const ok = capture();
    await expect(
      run(["run", "--book", "mini-book", "--axis", "extraction", "--runs", "1"], ok),
    ).resolves.toBe(EXIT_OK);
    expect(ok.out.join("\n")).toContain("runs: 1");

    const zero = capture();
    await expect(
      run(["run", "--book", "mini-book", "--axis", "extraction", "--runs", "0"], zero),
    ).resolves.toBe(EXIT_USAGE);

    const junk = capture();
    await expect(
      run(["run", "--book", "mini-book", "--axis", "extraction", "--runs", "many"], junk),
    ).resolves.toBe(EXIT_USAGE);
  });

  it("rejects an unknown --judge value and demands credentials for the live judge", async () => {
    installMiniBook();

    const unknown = capture();
    await expect(
      run(["run", "--book", "mini-book", "--axis", "extraction", "--judge", "oracle"], unknown),
    ).resolves.toBe(EXIT_USAGE);

    const live = capture();
    await expect(
      run(["run", "--book", "mini-book", "--axis", "extraction", "--judge", "live"], live),
    ).resolves.toBe(EXIT_USAGE);
    expect(live.err.join("\n")).toMatch(/AGNES_API_KEY/i);

    const configured = capture();
    let attemptedNetwork = false;
    const failingFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      attemptedNetwork = true;
      throw new Error("no network in tests");
    };
    try {
      await expect(
        run(["run", "--book", "mini-book", "--axis", "extraction", "--judge", "live"], configured, {
          env: { AGNES_API_KEY: "test-key" },
        }),
      ).rejects.toThrow(/connection error/i);
    } finally {
      globalThis.fetch = failingFetch;
    }
    expect(attemptedNetwork).toBe(true);
  });
});

describe("runCli — checker axis end-to-end (offline)", () => {
  it("runs the mini-book's perturbation and control fixtures and exits 0", async () => {
    installMiniBook();
    const io = capture();

    await expect(run(["run", "--book", "mini-book", "--axis", "checker"], io)).resolves.toBe(
      EXIT_OK,
    );

    const text = io.out.join("\n");
    expect(text).toContain("checker — mini-book");
    expect(text).toContain("ch03-holder-swap");
    expect(text).toContain("ch01-control");
    expect(text).toContain("perturbation catch rate 1.000");
    expect(text).toContain("control false-positive rate 0.000");
    expect(text).toContain("gates: PASS");
  });

  it("runs a book with no authored perturbations, reporting vacuous conventions", async () => {
    writeBook("tom-sawyer", [1, 2, 3]);
    const io = capture();

    await expect(run(["run", "--book", "tom-sawyer", "--axis", "checker"], io)).resolves.toBe(
      EXIT_OK,
    );
    expect(io.out.join("\n")).toContain("no perturbation or control cases authored");
  });

  it("prints machine-readable JSON when --format json is given", async () => {
    installMiniBook();
    const io = capture();

    await expect(
      run(["run", "--book", "mini-book", "--axis", "checker", "--format", "json"], io),
    ).resolves.toBe(EXIT_OK);

    const parsed = JSON.parse(io.out.join("\n")) as { passed: boolean; axis: string };
    expect(parsed.passed).toBe(true);
    expect(parsed.axis).toBe("checker");
  });

  it("exits via gate-failed code when a perturbation goes uncaught", async () => {
    installMiniBook();
    // Overwrite the edited chapter with the unmodified original so the real
    // fake checker sees nothing to contradict, forcing a genuine miss
    // through the actual harness rather than a stubbed checker.
    const ch03 = join(root, "mini-book", "source", "ch03.txt");
    const holderSwapTxt = join(root, "mini-book", "perturbations", "ch03-holder-swap.txt");
    writeFileSync(holderSwapTxt, readFileSync(ch03, "utf8"));

    const io = capture();
    await expect(
      run(["run", "--book", "mini-book", "--axis", "checker"], io),
    ).resolves.toBe(EXIT_GATE_FAILED);
    expect(io.out.join("\n")).toContain("gates: FAIL");
  });

  it("reports a perturbation referencing an unknown assertion id as a validation failure", async () => {
    installMiniBook();
    writeFileSync(
      join(root, "mini-book", "perturbations", "ch09-ghost.yml"),
      "kind: perturbation\nid: ch09-ghost\nbase_ordinal: 3\nfile: perturbations/ch03-holder-swap.txt\nedits:\n  - description: x\nviolates: [ghost-assertion-id]\nexpect: flag\n",
    );

    const io = capture();
    await expect(
      run(["run", "--book", "mini-book", "--axis", "checker"], io),
    ).resolves.toBe(EXIT_VALIDATION_FAILED);
    expect(io.err.join("\n")).toContain("ghost-assertion-id");
  });
});
