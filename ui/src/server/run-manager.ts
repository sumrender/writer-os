import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { isPlainObject, parseBenchmarkEvent, type BenchmarkEvent } from "@writer-os/benchmark/events";
import { parseRunConfig, type RunConfig } from "../shared/run-config.js";
import { listBooks } from "./books.js";

/**
 * The in-process run manager behind the benchmark UI's server functions
 * (issue #11): it spawns the built benchmarks CLI as a child process with
 * `--format events`, narrows every stdout line through
 * {@link parseBenchmarkEvent} before use (the child is a trust boundary,
 * CODING_STANDARDS §1.5), tracks the run's lifecycle, and persists finished
 * records as JSON under the gitignored ui-runs directory so history survives
 * dev-server restarts. Pure Node — no framework imports; the TanStack glue
 * lives in functions.ts. Effects (paths, environment) arrive as injected
 * dependencies so tests can sandbox them (CODING_STANDARDS §3.5).
 */

export const RUN_STATUSES = ["running", "completed", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && (RUN_STATUSES as readonly string[]).includes(value);
}

export interface RunSummary {
  readonly id: string;
  readonly config: RunConfig;
  readonly status: RunStatus;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly exitCode: number | null;
}

/** One poll result: the run's state plus only the events after `since`. */
export interface RunView extends RunSummary {
  readonly events: readonly BenchmarkEvent[];
  readonly nextIndex: number;
  readonly stderr: readonly string[];
}

export interface RunManagerDeps {
  /** Compiled CLI entry (`pnpm build:cli` produces it). */
  readonly cliEntry: string;
  readonly booksRoot: string;
  readonly uiRunsDir: string;
  /** Environment handed to the child; defaults to the server's own. */
  readonly env?: Record<string, string | undefined>;
}

export interface RunManager {
  startRun(config: RunConfig): RunSummary;
  getRun(id: string, since: number): RunView | null;
  cancelRun(id: string): void;
  listRuns(): readonly RunSummary[];
}

interface RunRecord {
  readonly id: string;
  readonly config: RunConfig;
  readonly startedAt: string;
  status: RunStatus;
  endedAt: string | null;
  exitCode: number | null;
  readonly events: BenchmarkEvent[];
  readonly stderr: string[];
  cancelRequested: boolean;
  settled: boolean;
  child: ChildProcessByStdio<null, Readable, Readable> | null;
}

function toSummary(record: RunRecord): RunSummary {
  return {
    id: record.id,
    config: record.config,
    status: record.status,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    exitCode: record.exitCode,
  };
}

function toView(record: RunRecord, since: number): RunView {
  const start = Math.max(0, Math.min(since, record.events.length));
  return {
    ...toSummary(record),
    events: record.events.slice(start),
    nextIndex: record.events.length,
    stderr: [...record.stderr],
  };
}

/** CLI arguments built exclusively from validated enum values. */
function cliArgs(config: RunConfig, booksRoot: string): string[] {
  return [
    "run",
    "--book",
    config.book,
    "--axis",
    config.axis,
    "--runs",
    String(config.runs),
    "--pipeline",
    config.pipeline,
    "--judge",
    config.judge,
    "--cache",
    String(config.cache),
    "--format",
    "events",
    "--log-level",
    "off",
    "--books-root",
    booksRoot,
  ];
}

/** Derive the terminal status from the child's event stream. */
function terminalStatus(events: readonly BenchmarkEvent[]): RunStatus {
  const last = events[events.length - 1];
  if (last?.type === "run.completed") return last.exitCode === 0 ? "completed" : "failed";
  return "failed";
}

/**
 * Rehydrate persisted records from disk. Every field is re-narrowed from the
 * untrusted JSON (CODING_STANDARDS §1.5); a corrupt or non-terminal record is
 * skipped rather than crashing the whole history load.
 */
function loadPersistedRecords(uiRunsDir: string): RunRecord[] {
  if (!existsSync(uiRunsDir)) return [];
  const records: RunRecord[] = [];
  for (const entry of readdirSync(uiRunsDir).sort()) {
    if (!entry.endsWith(".json")) continue;
    let parsed: RunRecord | null = null;
    try {
      parsed = parsePersistedRecord(JSON.parse(readFileSync(join(uiRunsDir, entry), "utf8")));
    } catch {
      parsed = null;
    }
    if (parsed !== null) records.push(parsed);
  }
  return records;
}

function parsePersistedRecord(raw: unknown): RunRecord | null {
  if (!isPlainObject(raw)) return null;
  const id = raw["id"];
  const startedAt = raw["startedAt"];
  const status = raw["status"];
  if (typeof id !== "string" || typeof startedAt !== "string" || !isRunStatus(status)) {
    return null;
  }
  // A persisted record is only written once a run settles; a "running" entry
  // would have no backing child, so it is not restorable.
  if (status === "running") return null;

  const configResult = parseRunConfig(raw["config"]);
  if (configResult.config === null) return null;

  const endedAt = raw["endedAt"];
  const exitCode = raw["exitCode"];
  const rawEvents = raw["events"];
  const rawStderr = raw["stderr"];
  if (!Array.isArray(rawEvents) || !Array.isArray(rawStderr)) return null;
  if (!rawStderr.every((line) => typeof line === "string")) return null;

  const events: BenchmarkEvent[] = [];
  for (const item of rawEvents) {
    const event = parseBenchmarkEvent(item);
    if (event === null) return null;
    events.push(event);
  }

  return {
    id,
    config: configResult.config,
    startedAt,
    status,
    endedAt: typeof endedAt === "string" ? endedAt : null,
    exitCode: typeof exitCode === "number" && Number.isInteger(exitCode) ? exitCode : null,
    events,
    stderr: [...rawStderr] as string[],
    cancelRequested: false,
    settled: true,
    child: null,
  };
}

export function createRunManager(deps: RunManagerDeps): RunManager {
  const records = new Map<string, RunRecord>();
  for (const record of loadPersistedRecords(deps.uiRunsDir)) {
    records.set(record.id, record);
  }
  let active: RunRecord | null = null;

  function persist(record: RunRecord): void {
    mkdirSync(deps.uiRunsDir, { recursive: true });
    const payload = {
      id: record.id,
      config: record.config,
      status: record.status,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      exitCode: record.exitCode,
      events: record.events,
      stderr: record.stderr,
    };
    writeFileSync(join(deps.uiRunsDir, `${record.id}.json`), JSON.stringify(payload));
  }

  function absorbLine(record: RunRecord, line: string): void {
    let event: BenchmarkEvent | null = null;
    try {
      event = parseBenchmarkEvent(JSON.parse(line));
    } catch {
      event = null;
    }
    if (event === null) {
      // Unparsable stdout never reaches rendering; it joins the raw log.
      record.stderr.push(line);
      return;
    }
    record.events.push(event);
  }

  function wireStdout(record: RunRecord, stdout: Readable): void {
    let pending = "";
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length > 0) absorbLine(record, line);
      }
    });
    stdout.on("end", () => {
      if (pending.length > 0) absorbLine(record, pending);
    });
  }

  function finalize(record: RunRecord, exitCode: number): void {
    // 'error' and 'close' can both fire for a single child; settle once.
    if (record.settled) return;
    record.settled = true;
    record.exitCode = exitCode;
    record.status = record.cancelRequested
      ? "cancelled"
      : terminalStatus(record.events);
    record.endedAt = new Date().toISOString();
    active = null;
    persist(record);
  }

  function spawnRun(record: RunRecord): void {
    const child = spawn(process.execPath, [deps.cliEntry, ...cliArgs(record.config, deps.booksRoot)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: deps.env ?? process.env,
    });
    record.child = child;
    wireStdout(record, child.stdout);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (line.length > 0) record.stderr.push(line);
      }
    });
    child.on("close", (code, signal) => {
      record.child = null;
      finalize(record, code ?? (signal === null ? 1 : 143));
    });
    // A spawn failure (e.g. the node binary vanishing after the existsSync
    // guard) surfaces as an 'error' event, not a nonzero close; without this
    // handler it would crash the dev server instead of yielding a clear
    // failure state (story 19).
    child.on("error", (cause) => {
      record.child = null;
      record.stderr.push(`spawn failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      finalize(record, 1);
    });
  }

  return {
    startRun(config) {
      if (!existsSync(deps.cliEntry)) {
        throw new Error(
          `benchmarks CLI not built (${deps.cliEntry}); run "pnpm build:cli" at the repo root first`,
        );
      }
      if (active !== null) {
        throw new Error(`a run is already active (${active.id}); runs never interleave`);
      }
      if (!listBooks(deps.booksRoot).some((b) => b.id === config.book)) {
        throw new Error(`unknown Fixture book: ${config.book}`);
      }
      const record: RunRecord = {
        id: randomUUID(),
        config,
        startedAt: new Date().toISOString(),
        status: "running",
        endedAt: null,
        exitCode: null,
        events: [],
        stderr: [],
    cancelRequested: false,
    settled: false,
        child: null,
      };
      records.set(record.id, record);
      active = record;
      spawnRun(record);
      return toSummary(record);
    },

    getRun(id, since) {
      const record = records.get(id);
      return record === undefined ? null : toView(record, since);
    },

    cancelRun(id) {
      const record = records.get(id);
      if (record === undefined || record.status !== "running" || record.child === null) {
        throw new Error(`run ${id} is not running`);
      }
      record.cancelRequested = true;
      record.child.kill("SIGTERM");
    },

    listRuns() {
      return [...records.values()]
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map(toSummary);
    },
  };
}
