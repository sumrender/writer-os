import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GateConfig } from "../lib/gates.js";
import {
  AXES,
  EXIT_OK,
  FORMATS,
  JUDGES,
  LOG_LEVELS,
  PIPELINES,
  type CliIo,
  type RunCliOverrides,
} from "./types.js";
import { runCli } from "./engine.js";
import type { BenchmarkConfig, GatesSelection } from "./config.js";

/**
 * The config-driven chain (docs/TESTING.md §9): executes a
 * {@link BenchmarkConfig} by pre-flight-validating every fixture and then
 * running one `run` per book×axis through the standard engine plumbing. This
 * module owns orchestration only — config types live in config.ts, the run
 * mechanics live in the engine and its commands.
 *
 * Direct execution of this package loads `benchmarks/.env` in cli.ts before
 * applying explicit `agnes` config values; library/test callers wire their
 * own environment and never trigger that load.
 */

/** Package root (benchmarks/), resolved so cwd never matters. */
export function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** The default io sink: process streams. */
export const consoleIo: CliIo = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

/** Outcome of one book×axis run (or of the pre-flight validation of a book). */
export interface RunResult {
  readonly book: string;
  /** Benchmark axis, or "validate" when pre-flight fixture validation failed. */
  readonly axis: string;
  /** Existing CLI exit-code semantics: 0 ok · 1 validation · 2 usage · 3 unimplemented axis · 4 gate failure. */
  readonly exitCode: number;
  /** Report file under runsDir when logToFiles is on. */
  readonly logPath?: string;
}

export interface BenchmarkSummary {
  readonly results: readonly RunResult[];
  /** True when every executed run (and every pre-flight validation) exited 0. */
  readonly allPassed: boolean;
}

function validateConfig(config: BenchmarkConfig): void {
  if (!Array.isArray(config.books) || config.books.length === 0) {
    throw new Error("config: books must be a non-empty array");
  }
  for (const book of config.books) {
    if (typeof book.id !== "string" || book.id.trim().length === 0) {
      throw new Error("config: every book needs a non-empty id");
    }
    if (book.runs !== undefined && (!Number.isInteger(book.runs) || book.runs < 1)) {
      throw new Error(`config: book ${book.id} runs must be an integer >= 1`);
    }
  }
  if (!Number.isInteger(config.runs) || config.runs < 1) {
    throw new Error("config: runs must be an integer >= 1");
  }
  if (!Array.isArray(config.axes) || config.axes.length === 0) {
    throw new Error("config: axes must be a non-empty array");
  }
  for (const axis of config.axes) {
    if (!(AXES as readonly string[]).includes(axis)) {
      throw new Error(`config: unknown axis "${axis}" (${AXES.join(", ")})`);
    }
  }
  if (!(PIPELINES as readonly string[]).includes(config.pipeline)) {
    throw new Error(`config: pipeline must be one of ${PIPELINES.join(", ")}`);
  }
  if (!(JUDGES as readonly string[]).includes(config.judge)) {
    throw new Error(`config: judge must be one of ${JUDGES.join(", ")}`);
  }
  if (!(FORMATS as readonly string[]).includes(config.format)) {
    throw new Error(`config: format must be one of ${FORMATS.join(", ")}`);
  }
  if (!(LOG_LEVELS as readonly string[]).includes(config.logLevel)) {
    throw new Error(`config: logLevel must be one of ${LOG_LEVELS.join(", ")}`);
  }
  if (typeof config.cache?.enabled !== "boolean") {
    throw new Error("config: cache.enabled must be a boolean");
  }
}

/** Explicit agnes config wins over the environment/.env so a config file is self-contained. */
function applyAgnesEnv(agnes: BenchmarkConfig["agnes"]): void {
  if (agnes.apiKey !== undefined) process.env.AGNES_API_KEY = agnes.apiKey;
  if (agnes.baseUrl !== undefined) process.env.AGNES_BASE_URL = agnes.baseUrl;
  if (agnes.minIntervalMs !== undefined) {
    process.env.AGNES_MIN_INTERVAL_MS = String(agnes.minIntervalMs);
  }
}

/**
 * Inline gate configs are serialized to the CLI's JSON gates-file wire
 * format (parseGateConfig expects snake_case keys); file selections pass
 * straight through. One temp file per distinct inline config per chain.
 */
function createGatesResolver(
  tempDir: string,
): (selection: GatesSelection | undefined) => string | undefined {
  const paths = new Map<string, string>();
  return (selection) => {
    if (selection === undefined) return undefined;
    if ("gatesFile" in selection) return selection.gatesFile;
    const key = JSON.stringify(selection);
    const existing = paths.get(key);
    if (existing !== undefined) return existing;
    const wire = {
      global_precision_min: selection.globalPrecisionMin,
      recall_min: selection.recallMin,
    };
    const path = join(tempDir, `gates-${paths.size}.json`);
    writeFileSync(path, JSON.stringify(wire, null, 2));
    paths.set(key, path);
    return path;
  };
}

/** UTC stamp matching the run-all-books.sh ledger convention. */
function utcStamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Tees io into a report file while everything still reaches the console. */
function teeToFile(io: CliIo, logPath: string | undefined): { io: CliIo; close: () => void } {
  if (logPath === undefined) return { io, close: () => {} };
  // Synchronous writes: a run completes entirely within one tick-chain, so
  // an async stream would flush only after callers may already read the log.
  const fd = openSync(logPath, "w");
  return {
    io: {
      stdout: (line) => {
        io.stdout(line);
        writeSync(fd, `${line}\n`);
      },
      stderr: (line) => {
        io.stderr(line);
        writeSync(fd, `${line}\n`);
      },
    },
    close: () => closeSync(fd),
  };
}

function appendIndex(runsDir: string, line: string): void {
  appendFileSync(join(runsDir, "index.txt"), `${line}\n`);
}

function headerLine(config: BenchmarkConfig): string {
  return [
    "benchmark:",
    `books=[${config.books.map((b) => b.id).join(", ")}]`,
    `axes=[${config.axes.join(", ")}]`,
    `runs=${config.runs}`,
    `pipeline=${config.pipeline}`,
    `judge=${config.judge}`,
    `cache=${config.cache.enabled ? "ENABLED" : "DISABLED"}`,
    `format=${config.format}`,
    `log-level=${config.logLevel}`,
  ].join(" ");
}

function printSummary(results: readonly RunResult[], io: CliIo): void {
  const ok = results.filter((r) => r.exitCode === EXIT_OK).length;
  const allPassed = results.every((r) => r.exitCode === EXIT_OK);
  io.stdout(
    `benchmark summary: ${results.length} run(s), ${ok} ok, ${results.length - ok} failed — allPassed=${allPassed}`,
  );
  for (const result of results) {
    const status = result.exitCode === EXIT_OK ? "ok  " : "FAIL";
    io.stdout(
      `  ${status} ${result.book.padEnd(20)} ${result.axis.padEnd(12)} exit=${result.exitCode}${
        result.logPath !== undefined ? `  ${result.logPath}` : ""
      }`,
    );
  }
}

function overridesFor(config: BenchmarkConfig, booksRoot: string): RunCliOverrides {
  return {
    ...(config.booksRoot !== undefined ? { booksRoot } : {}),
    ...(config.cache.judgeCachePath !== undefined ? { judgeCachePath: config.cache.judgeCachePath } : {}),
    ...(config.cache.extractCachePath !== undefined
      ? { extractCachePath: config.cache.extractCachePath }
      : {}),
  };
}

/**
 * Executes the configured benchmark chain: pre-flight fixture validation
 * (optional), then one `run` per book×axis through the standard CLI
 * plumbing. Returns the per-run outcomes; throws only on invalid config —
 * every model/fixture failure surfaces as a captured exit code instead.
 */
export async function runBenchmark(
  config: BenchmarkConfig,
  io: CliIo = consoleIo,
): Promise<BenchmarkSummary> {
  validateConfig(config);
  const booksRoot = config.booksRoot ?? join(packageRoot(), "books");
  const runsDir = config.runsDir ?? join(packageRoot(), "results", "runs");
  const overrides = overridesFor(config, booksRoot);
  applyAgnesEnv(config.agnes);

  const results: RunResult[] = [];
  const tempDir = mkdtempSync(join(tmpdir(), "bench-runner-gates-"));
  try {
    const resolveGates = createGatesResolver(tempDir);

    if (config.validateFirst) {
      for (const book of config.books) {
        const exitCode = await runCli(["validate", "--book", book.id], io, overrides);
        if (exitCode !== EXIT_OK) {
          results.push({ book: book.id, axis: "validate", exitCode });
        }
      }
      if (results.length > 0) {
        io.stdout("benchmark: pre-flight validation failed — no runs executed");
        printSummary(results, io);
        return { results, allPassed: false };
      }
    }

    io.stdout(headerLine(config));
    if (config.logToFiles) mkdirSync(runsDir, { recursive: true });

    let stopped = false;
    for (const book of config.books) {
      if (stopped) break;
      const axes = book.axes ?? config.axes;
      const runs = book.runs ?? config.runs;
      const pipeline = book.pipeline ?? config.pipeline;
      const judge = book.judge ?? config.judge;
      const gatesPath = resolveGates(book.gates ?? config.gates);

      for (const axis of axes) {
        if (stopped) break;

        const argv = [
          "run",
          "--book",
          book.id,
          "--axis",
          axis,
          "--runs",
          String(runs),
          "--pipeline",
          pipeline,
          "--judge",
          judge,
          "--format",
          config.format,
          "--log-level",
          config.logLevel,
          "--cache",
          String(config.cache.enabled),
          ...(gatesPath !== undefined ? ["--gates", gatesPath] : []),
        ];

        const logPath = config.logToFiles
          ? join(runsDir, `${utcStamp()}-${book.id}-${axis}.txt`)
          : undefined;
        if (logPath !== undefined) {
          appendIndex(
            runsDir,
            `START ${new Date().toISOString()} book=${book.id} axis=${axis} cache=${config.cache.enabled} log=${logPath}`,
          );
        }

        const target = teeToFile(io, logPath);
        const exitCode = await runCli(argv, target.io, overrides);
        target.close();

        if (logPath !== undefined) {
          appendIndex(
            runsDir,
            `END   ${new Date().toISOString()} book=${book.id} axis=${axis} exit=${exitCode} log=${logPath}`,
          );
        }

        results.push({ book: book.id, axis, exitCode, ...(logPath !== undefined ? { logPath } : {}) });
        io.stdout(
          `benchmark: ${book.id} ${axis} finished — exit=${exitCode}${
            logPath !== undefined ? ` log=${logPath}` : ""
          }`,
        );

        if (config.stopOnFailure && exitCode !== EXIT_OK) {
          io.stdout("benchmark: stopOnFailure — stopping before further runs");
          stopped = true;
        }
      }
    }

    printSummary(results, io);
    return { results, allPassed: results.every((r) => r.exitCode === EXIT_OK) };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}