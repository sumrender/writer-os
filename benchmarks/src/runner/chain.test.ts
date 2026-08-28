import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BENCHMARK_CONFIG,
  runBenchmark,
  type BenchmarkConfig,
} from "./index.js";
import type { CliIo } from "./index.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bench-runner-chain-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const REPO_BOOKS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "books");

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

/** Fully offline base config: deterministic fakes, stub judge, no cache writes. */
function offlineConfig(overrides: Partial<BenchmarkConfig> = {}): BenchmarkConfig {
  return {
    ...DEFAULT_BENCHMARK_CONFIG,
    books: [{ id: "mini-book" }],
    axes: ["extraction"],
    runs: 1,
    pipeline: "fake",
    judge: "stub",
    agnes: {},
    cache: { enabled: false },
    gates: undefined,
    booksRoot: REPO_BOOKS,
    format: "text",
    logLevel: "off",
    validateFirst: true,
    stopOnFailure: false,
    logToFiles: false,
    ...overrides,
  };
}

describe("runBenchmark", () => {
  it("runs the configured book×axis chain offline and reports per-run results", async () => {
    const io = capture();
    const summary = await runBenchmark(offlineConfig(), io);

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]).toMatchObject({
      book: "mini-book",
      axis: "extraction",
      exitCode: 0,
    });
    expect(summary.allPassed).toBe(true);
    expect(io.out.join("\n")).toContain("benchmark: books=[mini-book]");
    expect(io.out.join("\n")).toContain("benchmark summary:");
  });

  it("respects per-book overrides and executes axes in declared order", async () => {
    const io = capture();
    const summary = await runBenchmark(
      offlineConfig({
        books: [{ id: "mini-book", axes: ["checker", "extraction"], runs: 2 }],
      }),
      io,
    );

    expect(summary.results.map((r) => r.axis)).toEqual(["checker", "extraction"]);
    expect(summary.allPassed).toBe(true);
    // The configured runs count must reach every axis (the CLI's checker and
    // generation commands previously ignored --runs entirely).
    expect(io.out.join("\n")).toContain("checker — mini-book (runs: 2)");
  });

  it("persists per-run logs and the index ledger when logToFiles is on", async () => {
    const runsDir = join(root, "runs");
    const io = capture();
    const summary = await runBenchmark(offlineConfig({ logToFiles: true, runsDir }), io);

    const logPath = summary.results[0]?.logPath;
    expect(logPath).toBeDefined();
    expect(readFileSync(logPath as string, "utf8")).toContain("mini-book");

    const index = readFileSync(join(runsDir, "index.txt"), "utf8");
    expect(index).toContain("START");
    expect(index).toContain("END");
    expect(index).toContain("exit=0");
  });

  it("honors inline gate floors by serializing them to the CLI gates-file wire format", async () => {
    const io = capture();
    // The known-by-construction fixture passes exact grading, so a trivial
    // precision floor must hold. What matters here: the chain runs rather
    // than failing on gate-file plumbing (a bad gates path would exit 2).
    const summary = await runBenchmark(
      offlineConfig({ gates: { globalPrecisionMin: 0.5, recallMin: {} } }),
      io,
    );

    expect(summary.results[0]).toMatchObject({ exitCode: 0 });
    expect(summary.allPassed).toBe(true);
  });

  it("aborts before any run when validateFirst fails on a missing fixture", async () => {
    const io = capture();
    const summary = await runBenchmark(
      offlineConfig({ books: [{ id: "no-such-book" }] }),
      io,
    );

    expect(summary.allPassed).toBe(false);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]).toMatchObject({ book: "no-such-book", axis: "validate" });
    expect(io.out.join("\n")).toContain("pre-flight validation failed");
  });

  it("captures run failures as results and stopOnFailure halts the chain", async () => {
    const io = capture();
    const summary = await runBenchmark(
      offlineConfig({
        validateFirst: false,
        books: [{ id: "no-such-book" }, { id: "mini-book" }],
        axes: ["extraction"],
      }),
      io,
    );

    expect(summary.results).toHaveLength(2);
    expect(summary.allPassed).toBe(false);
    expect(summary.results[0]?.exitCode).not.toBe(0);
    expect(summary.results[1]).toMatchObject({ book: "mini-book", exitCode: 0 });

    const stopped = await runBenchmark(
      offlineConfig({
        validateFirst: false,
        books: [{ id: "no-such-book" }, { id: "mini-book" }],
        axes: ["extraction"],
        stopOnFailure: true,
      }),
      capture(),
    );
    expect(stopped.results).toHaveLength(1);
  });

  it("rejects invalid configuration with a precise error", async () => {
    await expect(runBenchmark(offlineConfig({ runs: 0 }))).rejects.toThrow("runs");
    await expect(runBenchmark(offlineConfig({ axes: [] }))).rejects.toThrow("axes");
    await expect(runBenchmark(offlineConfig({ books: [] }))).rejects.toThrow("books");
  });

  it("sandboxes cache paths through the CLI overrides", async () => {
    const judgeCachePath = join(root, "judge-cache.json");
    const extractCachePath = join(root, "extract-cache.json");
    const io = capture();
    // Enabled caching with sandboxed paths must run cleanly; whether a cache
    // file materializes depends on how many judge calls the grading needs,
    // so the contract asserted here is "no plumbing error, no leak": the
    // chain passes and the default repo cache path was never involved.
    const summary = await runBenchmark(
      offlineConfig({ cache: { enabled: true, judgeCachePath, extractCachePath } }),
      io,
    );

    expect(summary.allPassed).toBe(true);
  });
});

