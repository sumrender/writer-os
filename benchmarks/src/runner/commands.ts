import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { maxOrdinal, validateBook } from "../lib/manifest.js";
import { loadAssertionSet } from "../lib/assertion-file.js";
import { loadBeatSet } from "../lib/beat-file.js";
import { loadPerturbationSet } from "../lib/perturbation-file.js";
import { runExtractionAxis, type ExtractionAxisReport } from "./axes/extraction-axis.js";
import { runCheckerAxis } from "./axes/checker-axis.js";
import { runGenerationAxis } from "./axes/generation-axis.js";
import {
  formatCheckerJsonReport,
  formatCheckerTextReport,
  formatGenerationJsonReport,
  formatGenerationTextReport,
  formatJsonReport,
  formatTextReport,
} from "./report.js";
import type { Logger } from "../lib/logger.js";
import {
  AXES,
  EXIT_NOT_IMPLEMENTED,
  EXIT_OK,
  EXIT_USAGE,
  EXIT_VALIDATION_FAILED,
  exitCodeForPassed,
  FORMATS,
  LOG_LEVELS,
  type Axis,
  type CliIo,
  type Format,
  type RunCliOverrides,
} from "./types.js";
import {
  booksRootOf,
  buildLogger,
  cacheEnabledOf,
  isFormat,
  loadGateConfig,
  logLevelOf,
  parseRunCount,
  type Options,
} from "./flags.js";
import { buildPipelineOps, selectJudge, wrapJudge, type PipelineOps } from "./ops.js";
import { printValidationErrors, validateOrReport, type LoadedBook } from "./validation.js";
import { createEventEmitter, type BenchmarkEventEmitter } from "./events.js";
import { USAGE } from "./usage.js";

/**
 * The `run` and `list` commands plus the three axis end-to-end commands:
 * what a run loads, what it executes, and how its report reaches the io
 * sink. All fixture/flag/pipeline concerns arrive already resolved via
 * flags.ts, validation.ts, and ops.ts.
 */

function isAxis(value: string | undefined): value is Axis {
  return AXES.includes(value as Axis);
}

type AxisCommand = (
  book: LoadedBook,
  format: Format,
  options: Options,
  io: CliIo,
  overrides: RunCliOverrides,
  ops: PipelineOps,
  log: Logger,
  events: BenchmarkEventEmitter | null,
) => Promise<number>;

const AXIS_COMMANDS: ReadonlyMap<Axis, AxisCommand> = new Map([
  ["extraction", runExtractionCommand],
  ["checker", runCheckerCommand],
  ["generation", runGenerationCommand],
]);

/** Emits the terminal `run.failed` event when an events-format run aborts. */
function failRun(
  events: BenchmarkEventEmitter | null,
  exitCode: number,
  message: string,
): number {
  events?.emit({ type: "run.failed", exitCode, message });
  return exitCode;
}

export async function commandRun(
  options: Options,
  io: CliIo,
  overrides: RunCliOverrides,
): Promise<number> {
  const id = options.book;
  if (!id) {
    io.stderr("missing required flag: --book <id>");
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  if (!isAxis(options.axis)) {
    io.stderr(
      `missing or invalid flag: --axis <${AXES.join("|")}> (got: ${options.axis ?? "(none)"})`,
    );
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  // Format is validated after book/axis so text/json usage-error output keeps
  // its historical order (the events seam is purely additive).
  const format = options.format ?? "text";
  if (!isFormat(format)) {
    io.stderr(`--format must be one of ${FORMATS.join(", ")} (got: ${options.format})`);
    return EXIT_USAGE;
  }
  // The NDJSON event stream is the extraction axis's protocol (chapter-level
  // progress + Story Bible snapshots); checker/generation keep text/json.
  if (format === "events" && options.axis !== "extraction") {
    io.stderr(`--format events is only supported for the extraction axis (got: --axis ${options.axis})`);
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  const events = format === "events" ? createEventEmitter(io.stdout) : null;
  // Machine-readable formats keep stdout pure; human chatter moves to stderr.
  const machine = format === "json" || format === "events";

  const cacheEnabled = cacheEnabledOf(options, io);
  if (cacheEnabled === null) {
    io.stderr(USAGE);
    return failRun(events, EXIT_USAGE, "--cache must be one of true, false");
  }
  const logLevel = logLevelOf(options, io);
  if (logLevel === null) {
    io.stderr(USAGE);
    return failRun(events, EXIT_USAGE, `--log-level must be one of ${LOG_LEVELS.join(", ")}`);
  }
  const log = buildLogger(io, logLevel);
  log.info(`log level: ${logLevel}`);
  // Always announced so cached-vs-fresh provenance of every report is
  // unambiguous from its own output. Machine-readable mode keeps stdout
  // pure JSON, so the announcement follows the validation-chatter pattern.
  const announce = (line: string): void =>
    machine ? io.stderr(line) : io.stdout(line);
  announce(
    `cache: ${cacheEnabled ? "ENABLED" : "DISABLED"} — ${
      cacheEnabled
        ? "judge verdicts + extraction responses persist by input hash under results/cache/"
        : "every model call reaches the API fresh; nothing persists"
    }`,
  );

  // Machine-readable mode keeps stdout pure JSON; validation chatter moves
  // out of the way (errors already go to stderr regardless).
  const result = validateOrReport(
    id,
    options,
    machine ? { stdout: () => {}, stderr: io.stderr } : io,
    overrides,
  );
  if (!result) {
    return failRun(events, EXIT_VALIDATION_FAILED, `fixture validation failed for ${id}`);
  }

  const book: LoadedBook = { bookId: id, bookDir: result.bookDir, chapters: result.chapters };

  const command = AXIS_COMMANDS.get(options.axis);
  if (command !== undefined) {
    const ops = buildPipelineOps(options, io, overrides, cacheEnabled, log);
    if (ops === null) {
      return failRun(events, EXIT_USAGE, "pipeline selection failed (see stderr)");
    }
    const exitCode = await command(book, format, options, io, overrides, ops, log, events);
    if (events !== null && !events.finished) {
      return failRun(events, exitCode, `run exited ${exitCode} without completing`);
    }
    return exitCode;
  }

  io.stdout(
    `axis "${options.axis}" has no pipeline registered yet; fixture ingestion and validation passed`,
  );
  io.stderr(
    `axis "${options.axis}" is not implemented yet (pipeline port lands with the harness work)`,
  );
  return EXIT_NOT_IMPLEMENTED;
}

/**
 * Extraction end-to-end: assertions → N graded runs over the registered
 * pipeline → cached judge mediation → sweep → gates. Everything prints;
 * nothing tracked is written except the gitignored verdict cache.
 */
async function runExtractionCommand(
  book: LoadedBook,
  format: Format,
  options: Options,
  io: CliIo,
  overrides: RunCliOverrides,
  ops: PipelineOps,
  log: Logger,
  events: BenchmarkEventEmitter | null,
): Promise<number> {
  const assertions = loadAssertionSet(book.bookDir, { maxOrdinal: maxOrdinal(book.chapters) });
  if (!assertions.ok) {
    printValidationErrors(io, book.bookId, assertions.errors);
    return failRun(events, EXIT_VALIDATION_FAILED, `assertion set validation failed for ${book.bookId}`);
  }

  const gates = loadGateConfig(options, io);
  if (gates === null) return failRun(events, EXIT_USAGE, "invalid gates configuration");

  const runs = parseRunCount(options.runs);
  if (runs === null) {
    io.stderr("--runs must be an integer >= 1");
    return failRun(events, EXIT_USAGE, "--runs must be an integer >= 1");
  }

  const baseJudge = selectJudge(options.judge ?? "stub", io, ops.agnesClient, log);
  if (baseJudge === null) return failRun(events, EXIT_USAGE, "invalid judge selection");

  const judge = wrapJudge(
    baseJudge,
    cacheEnabledOf(options, io) ?? true,
    options,
    overrides,
    log,
  );

  let report: ExtractionAxisReport;
  try {
    report = await runExtractionAxis({
      bookId: book.bookId,
      chapters: book.chapters,
      assertions: assertions.set,
      extract: ops.extract,
      judge,
      gates,
      runs,
      log,
      onEvent: events === null ? undefined : (event) => events.emit(event),
    });
  } catch (cause) {
    // Text/json runs keep the historical crash-to-entry contract; the events
    // stream must always terminate with an explicit run.failed instead.
    if (events === null) throw cause;
    const message = cause instanceof Error ? cause.message : String(cause);
    return failRun(events, EXIT_VALIDATION_FAILED, `extraction run failed: ${message}`);
  }

  // The events stream already carried the report inside run.completed;
  // text/json formats print it to stdout as before.
  if (format === "json") {
    io.stdout(formatJsonReport(report));
  } else if (format === "text") {
    for (const line of formatTextReport(report)) {
      io.stdout(line);
    }
  }

  return exitCodeForPassed(report.passed);
}

/**
 * Checker end-to-end: re-extract canon per run, load the book's perturbation
 * and control cases, grade must-flag / must-not-flag outcomes against the
 * fake checker. A book with no authored cases still runs and reports the
 * vacuous-pass conventions — authoring real perturbations stays a
 * documented human task (docs/TESTING.md §7).
 */
async function runCheckerCommand(
  book: LoadedBook,
  format: Format,
  options: Options,
  io: CliIo,
  _overrides: RunCliOverrides,
  ops: PipelineOps,
  _log: Logger,
  _events: BenchmarkEventEmitter | null,
): Promise<number> {
  // Assertions are optional here: books with no authored assertion set yet
  // (checker fixtures precede assertion authoring per docs/TESTING.md §10)
  // simply skip `violates` cross-checks. A present-but-invalid file still
  // fails, matching every other validated-input path in this CLI.
  const assertions = loadAssertionSet(book.bookDir, { maxOrdinal: maxOrdinal(book.chapters) });
  let assertionIds: ReadonlySet<string> | undefined;
  if (assertions.ok) {
    assertionIds = new Set(assertions.set.assertions.map((a) => a.id));
  } else if (!assertions.errors.every((e) => e.code === "E_ASSERTION_FILE_MISSING")) {
    printValidationErrors(io, book.bookId, assertions.errors);
    return EXIT_VALIDATION_FAILED;
  }

  const perturbations = loadPerturbationSet(book.bookDir, book.chapters, assertionIds);
  if (!perturbations.ok) {
    printValidationErrors(io, book.bookId, perturbations.errors);
    return EXIT_VALIDATION_FAILED;
  }

  const runs = parseRunCount(options.runs);
  if (runs === null) {
    io.stderr("--runs must be an integer >= 1");
    return EXIT_USAGE;
  }

  const report = await runCheckerAxis({
    bookId: book.bookId,
    chapters: book.chapters,
    cases: perturbations.cases,
    extract: ops.extract,
    check: ops.check,
    runs,
  });

  if (format === "json") {
    io.stdout(formatCheckerJsonReport(report));
  } else {
    for (const line of formatCheckerTextReport(report)) {
      io.stdout(line);
    }
  }

  return exitCodeForPassed(report.passed);
}

/**
 * Generation end-to-end: re-extract canon per run, load the book's beat
 * declarations, generate each declared chapter from canon strictly before
 * its ordinal, and dual-grade (beat assertions via the equivalence-only
 * judge + checker-mediated context assembly). The same judge-cache pattern
 * as extraction keeps must_include paraphrases offline and regrade-free.
 */
async function runGenerationCommand(
  book: LoadedBook,
  format: Format,
  options: Options,
  io: CliIo,
  overrides: RunCliOverrides,
  ops: PipelineOps,
  log: Logger,
  _events: BenchmarkEventEmitter | null,
): Promise<number> {
  const beats = loadBeatSet(book.bookDir, { maxOrdinal: maxOrdinal(book.chapters) });
  if (!beats.ok) {
    printValidationErrors(io, book.bookId, beats.errors);
    return EXIT_VALIDATION_FAILED;
  }

  const baseJudge = selectJudge(options.judge ?? "stub", io, ops.agnesClient, log);
  if (baseJudge === null) return EXIT_USAGE;

  const judge = wrapJudge(
    baseJudge,
    cacheEnabledOf(options, io) ?? true,
    options,
    overrides,
    log,
  );

  const runs = parseRunCount(options.runs);
  if (runs === null) {
    io.stderr("--runs must be an integer >= 1");
    return EXIT_USAGE;
  }

  const report = await runGenerationAxis({
    bookId: book.bookId,
    chapters: book.chapters,
    beats: beats.set,
    extract: ops.extract,
    generate: ops.generate,
    check: ops.check,
    judge,
    runs,
  });

  if (format === "json") {
    io.stdout(formatGenerationJsonReport(report));
  } else {
    for (const line of formatGenerationTextReport(report)) {
      io.stdout(line);
    }
  }

  return exitCodeForPassed(report.passed);
}

export function commandList(options: Options, io: CliIo, overrides: RunCliOverrides): number {
  const rootDir = booksRootOf(options, overrides);
  let anyInvalid = false;

  for (const entry of readdirSync(rootDir).sort()) {
    const bookDir = join(rootDir, entry);
    if (!statSync(bookDir).isDirectory()) continue;
    const result = validateBook(bookDir);
    if (result.ok) {
      io.stdout(`ok   ${entry}: ${result.chapters.length} chapters`);
    } else {
      anyInvalid = true;
      io.stdout(`bad  ${entry}`);
      for (const error of result.errors) {
        io.stdout(`     [${error.code}] ${error.message}`);
      }
    }
  }

  return anyInvalid ? EXIT_VALIDATION_FAILED : EXIT_OK;
}


