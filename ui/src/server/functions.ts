import { createServerFn } from "@tanstack/react-start";
import { isPlainObject } from "@writer-os/benchmark/events";
import { listBooks, type BookSummary } from "./books.js";
import { agnesCredentialsConfigured } from "./credentials.js";
import { parseRunConfig } from "../shared/run-config.js";
import { runManager, serverPaths } from "./run-manager.server.js";
import type { RunSummary, RunView } from "./run-manager.js";

/**
 * The server-function layer over the run manager (issue #11). Each handler is
 * thin glue: it narrows the untrusted network payload through the shared
 * validators, then delegates to the singleton manager. Errors (busy, unknown
 * book, missing CLI) are thrown so they serialize to the client with a clear
 * message. No secret ever crosses — credentials leave as a boolean only.
 */

/** Narrows the `{ id }` bag shared by the run-scoped functions. */
function parseRunId(raw: unknown): string {
  if (!isPlainObject(raw)) throw new Error("Expected a run id.");
  const id = raw["id"];
  if (typeof id !== "string" || id.length === 0) throw new Error("Missing run id.");
  return id;
}

export interface BooksPayload {
  readonly books: readonly BookSummary[];
  readonly agnesConfigured: boolean;
}

export const getBooks = createServerFn({ method: "GET" }).handler((): BooksPayload => {
  return {
    books: listBooks(serverPaths.booksRoot),
    agnesConfigured: agnesCredentialsConfigured(serverPaths.envFile),
  };
});

export interface StartRunResult {
  readonly id: string;
  readonly config: RunSummary["config"];
}

export const startRun = createServerFn({ method: "POST" })
  .validator((raw: unknown) => {
    const { config, errors } = parseRunConfig(raw);
    if (config === null) {
      throw new Error(Object.values(errors).join(" ") || "Invalid run configuration.");
    }
    // A book is runnable only when it ships an assertion set for the
    // Extraction axis; the form disables the rest, but the server enforces it
    // too so an invalid config never spawns a process.
    const book = listBooks(serverPaths.booksRoot).find((b) => b.id === config.book);
    if (book === undefined) throw new Error(`unknown Fixture book: ${config.book}`);
    if (!book.enabled) {
      throw new Error(`book "${config.book}" has no assertion set to grade against yet`);
    }
    return config;
  })
  .handler(({ data }): StartRunResult => {
    const summary = runManager.startRun(data);
    return { id: summary.id, config: summary.config };
  });

function parseRunQuery(raw: unknown): { id: string; since: number } {
  const id = parseRunId(raw);
  const sinceRaw = isPlainObject(raw) ? raw["since"] : undefined;
  const since = typeof sinceRaw === "number" ? sinceRaw : Number(sinceRaw ?? 0);
  if (!Number.isInteger(since) || since < 0) throw new Error("Invalid event index.");
  return { id, since };
}

export const getRun = createServerFn({ method: "GET" })
  .validator((raw: unknown) => parseRunQuery(raw))
  .handler(({ data }): RunView | null => runManager.getRun(data.id, data.since));

export const cancelRun = createServerFn({ method: "POST" })
  .validator((raw: unknown) => parseRunId(raw))
  .handler(({ data }): void => {
    runManager.cancelRun(data);
  });

export const listRuns = createServerFn({ method: "GET" }).handler(
  (): readonly RunSummary[] => runManager.listRuns(),
);
