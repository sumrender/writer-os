import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BenchmarkEvent } from "@writer-os/benchmark/events";
import { DEFAULT_RUN_CONFIG, type RunConfig } from "../shared/run-config.js";
import { createRunManager, type RunManager, type RunView } from "./run-manager.js";

/**
 * Process-boundary seam (issue #11 testing decisions): these tests spawn the
 * REAL built benchmarks CLI offline (fake pipeline, stub judge) and assert
 * run-manager behavior through its public interface only — lifecycle
 * transitions, event buffering, cancel, busy rejection, failure surfacing,
 * and persistence round-trips.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const REPO_BOOKS = join(REPO_ROOT, "benchmarks", "books");
const CLI_ENTRY = join(REPO_ROOT, "benchmarks", "dist", "runner", "cli.js");

let root: string;
let booksRoot: string;
let uiRunsDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ui-run-manager-"));
  booksRoot = join(root, "books");
  uiRunsDir = join(root, "ui-runs");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function installBook(id: string): void {
  cpSync(join(REPO_BOOKS, id), join(booksRoot, id), { recursive: true });
}

function makeManager(): RunManager {
  return createRunManager({ cliEntry: CLI_ENTRY, booksRoot, uiRunsDir });
}

function configWith(overrides: Partial<RunConfig> = {}): RunConfig {
  return { ...DEFAULT_RUN_CONFIG, ...overrides };
}

/** Polls getRun — the same access path the UI uses — until the run settles. */
async function waitForTerminal(manager: RunManager, id: string): Promise<RunView> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const view = manager.getRun(id, 0);
    if (view === null) throw new Error(`run ${id} vanished`);
    if (view.status !== "running") return view;
    if (Date.now() > deadline) throw new Error(`run ${id} still running after 30s`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function eventTypes(events: readonly BenchmarkEvent[]): string[] {
  return events.map((e) => e.type);
}

describe("run manager lifecycle (real built CLI, offline fake/stub)", () => {
  it("runs a mini-book benchmark to completion with the deterministic event sequence", async () => {
    installBook("mini-book");
    const manager = makeManager();

    const started = manager.startRun(configWith());
    expect(started.status).toBe("running");
    expect(started.config).toEqual(configWith());

    const finished = await waitForTerminal(manager, started.id);
    expect(finished.status).toBe("completed");
    expect(finished.exitCode).toBe(0);
    expect(finished.endedAt).not.toBeNull();

    expect(eventTypes(finished.events)).toEqual([
      "run.started",
      "chapter.started",
      "chapter.completed",
      "chapter.started",
      "chapter.completed",
      "chapter.started",
      "chapter.completed",
      "chapter.started",
      "chapter.completed",
      "run.completed",
    ]);

    const completed = finished.events[9];
    if (completed?.type !== "run.completed") throw new Error("expected run.completed");
    expect(completed.report.passed).toBe(true);
    expect(completed.bible.characters.map((c) => c.name)).toEqual(["Mara Vey", "Joren Vey"]);
  });

  it("persists the finished run record to disk under the ui-runs directory", async () => {
    installBook("mini-book");
    const manager = makeManager();

    const started = manager.startRun(configWith());
    await waitForTerminal(manager, started.id);

    expect(readdirSync(uiRunsDir)).toEqual([`${started.id}.json`]);
  });

  it("returns only events after the since-index, with the next index", async () => {
    installBook("mini-book");
    const manager = makeManager();

    const started = manager.startRun(configWith());
    const first = manager.getRun(started.id, 0);
    expect(first).not.toBeNull();
    if (first === null) return;

    const finished = await waitForTerminal(manager, started.id);
    expect(finished.events.length).toBeGreaterThan(0);
    expect(finished.nextIndex).toBe(10);

    const tail = manager.getRun(started.id, finished.nextIndex);
    expect(tail?.events).toEqual([]);
    expect(tail?.nextIndex).toBe(10);

    const lastTwo = manager.getRun(started.id, 8);
    expect(eventTypes(lastTwo?.events ?? [])).toEqual(["chapter.completed", "run.completed"]);
    expect(lastTwo?.nextIndex).toBe(10);
  });

  it("rejects a second run while one is active", async () => {
    installBook("tom-sawyer");
    const manager = makeManager();

    const started = manager.startRun(configWith({ book: "tom-sawyer", runs: 30 }));
    expect(() => manager.startRun(configWith())).toThrow(/already running|active/i);

    await waitForTerminal(manager, started.id);
  });

  it("cancels an active run: the child dies and the record ends as cancelled", async () => {
    installBook("tom-sawyer");
    const manager = makeManager();

    const started = manager.startRun(configWith({ book: "tom-sawyer", runs: 30 }));
    // Wait for the first buffered event so the child is definitely spawned.
    const deadline = Date.now() + 10_000;
    while ((manager.getRun(started.id, 0)?.events.length ?? 0) === 0) {
      if (Date.now() > deadline) throw new Error("no events arrived");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    manager.cancelRun(started.id);
    const cancelled = await waitForTerminal(manager, started.id);

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.endedAt).not.toBeNull();
    expect(eventTypes(cancelled.events)).not.toContain("run.completed");
  });

  it("refuses to cancel a run that is not active", async () => {
    installBook("mini-book");
    const manager = makeManager();

    const started = manager.startRun(configWith());
    await waitForTerminal(manager, started.id);

    expect(() => manager.cancelRun(started.id)).toThrow(/not running|unknown/i);
    expect(() => manager.cancelRun("no-such-run")).toThrow(/not running|unknown/i);
  });

  it("surfaces a nonzero-exit failure with the run.failed event", async () => {
    installBook("mini-book");
    rmSync(join(booksRoot, "mini-book", "source", "ch02.txt"));
    const manager = makeManager();

    const started = manager.startRun(configWith());
    const failed = await waitForTerminal(manager, started.id);

    expect(failed.status).toBe("failed");
    expect(failed.exitCode).toBe(1);
    expect(eventTypes(failed.events)).toEqual(["run.failed"]);
    const last = failed.events[0];
    if (last?.type !== "run.failed") throw new Error("expected run.failed");
    expect(last.message).toContain("mini-book");
  });

  it("reloads finished runs from disk in a fresh manager (history survives restarts)", async () => {
    installBook("mini-book");
    const first = makeManager();
    const started = first.startRun(configWith());
    const original = await waitForTerminal(first, started.id);

    const reopened = makeManager();
    expect(reopened.listRuns().map((r) => r.id)).toEqual([started.id]);

    const view = reopened.getRun(started.id, 0);
    expect(view?.status).toBe("completed");
    expect(view?.exitCode).toBe(0);
    expect(eventTypes(view?.events ?? [])).toEqual(eventTypes(original.events));
    expect(view?.stderr).toEqual(original.stderr);

    // A restart clears the busy state: the fresh manager can start again.
    const second = reopened.startRun(configWith());
    await waitForTerminal(reopened, second.id);
    expect(reopened.listRuns()).toHaveLength(2);
  });
});
