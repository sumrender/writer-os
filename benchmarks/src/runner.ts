import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  maxOrdinal,
  validateBook,
  type BookManifest,
  type ValidationError,
  type ValidatedChapter,
} from "./lib/manifest.js";
import { loadAssertionSet } from "./lib/assertion-file.js";
import { loadBeatSet } from "./lib/beat-file.js";
import { DEFAULT_GATES, parseGateConfig, type GateConfig } from "./lib/gates.js";
import type { Judge } from "./lib/judge.js";
import { createStubJudge } from "./lib/stub-judge.js";
import { createLiveJudge } from "./lib/live-judge.js";
import { CachingJudge } from "./lib/cached-judge.js";
import { FileVerdictCache } from "./lib/verdict-cache.js";
import { fakeCheck, fakeExtract, fakeGenerate } from "./lib/fakes.js";
import { createAgnesClient, type AgnesClient } from "./lib/agnes-client.js";
import { createAgnesExtract } from "./lib/agnes-extract.js";
import { FileResponseCache } from "./lib/response-cache.js";
import { createAgnesCheck } from "./lib/agnes-check.js";
import { createAgnesGenerate } from "./lib/agnes-generate.js";
import type { Check, Extract, Generate } from "./lib/pipeline.js";
import { loadPerturbationSet } from "./lib/perturbation-file.js";
import { RUNS_PER_BOOK } from "./lib/metrics.js";
import { runExtractionAxis } from "./extraction-axis.js";
import { runCheckerAxis } from "./checker-axis.js";
import { runGenerationAxis } from "./generation-axis.js";
import {
  formatCheckerJsonReport,
  formatCheckerTextReport,
  formatGenerationJsonReport,
  formatGenerationTextReport,
  formatJsonReport,
  formatTextReport,
} from "./report.js";
import { levelFilter, stderrLogger, type LogLevel, type Logger } from "./lib/logger.js";

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export const EXIT_OK = 0;
export const EXIT_VALIDATION_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_NOT_IMPLEMENTED = 3;
export const EXIT_GATE_FAILED = 4;

const AXES = ["extraction", "checker", "generation"] as const;
type Axis = (typeof AXES)[number];

const JUDGES = ["stub", "live"] as const;
const FORMATS = ["text", "json"] as const;
const PIPELINES = ["live", "fake"] as const;
type PipelineKind = (typeof PIPELINES)[number];

const LOG_LEVELS = ["off", "info", "debug"] as const;

/**
 * The registered operation implementations per selection: vendor-backed
 * (default) or deterministic fakes (`--pipeline fake`, fully offline). One
 * AgnesClient backs every live op, so rate-limit spacing stays global even
 * when judge verdicts interleave with pipeline traffic.
 */
interface PipelineOps {
  readonly extract: Extract;
  readonly check: Check;
  readonly generate: Generate;
  /** Present exactly when the ops share their client with the judge seam. */
  readonly agnesClient?: AgnesClient;
}

const USAGE = `usage:
  bench validate --book <id> [--books-root <dir>]
  bench run --book <id> --axis <extraction|checker|generation>
            [--runs <n>] [--pipeline <live|fake>] [--judge <stub|live>]
            [--cache <true|false>] [--log-level <off|info|debug>]
            [--format <text|json>] [--gates <file>] [--books-root <dir>]
  bench list [--books-root <dir>]
  bench help

run defaults: ${RUNS_PER_BOOK} runs · live pipelines (AGNES_API_KEY required;
pass --pipeline fake for a fully offline run) · stub judge · text report · lenient gates · cache on · info logs
The judge and pipelines share one rate-limited Agnes client (free tier executes
~20 RPM; AGNES_MIN_INTERVAL_MS widens the spacing). --cache true (default)
persists judge verdicts and extraction responses by input hash under
results/cache/; --cache false forces every call to reach the API fresh.
--log-level controls progress lines on stderr (stdout stays pure for --format json):
info = phase + per-chapter + per-assertion progress; debug = + every API call,
cache hit/miss, and retry. Both off by default at --log-level off.`;

const defaultBooksRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "books",
);

interface Options {
  book?: string;
  axis?: string;
  booksRoot?: string;
  runs?: string;
  judge?: string;
  format?: string;
  gates?: string;
  pipeline?: string;
  cache?: string;
  logLevel?: string;
}

export interface RunCliOverrides {
  booksRoot?: string;
  /** Injected by tests so cache writes never leave the sandbox. */
  judgeCachePath?: string;
  /** Injected by tests so extraction cache writes never leave the sandbox. */
  extractCachePath?: string;
}

interface ResolvedOptions {
  book: string;
  axis: Axis;
  booksRoot: string;
}

export function runCli(
  argv: string[],
  io: CliIo,
  overrides: RunCliOverrides = {},
): Promise<number> {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    io.stdout(USAGE);
    return Promise.resolve(EXIT_OK);
  }

  const [command, ...rest] = argv;
  let options: Options;
  try {
    options = parseOptions(rest);
  } catch (cause) {
    io.stderr(String(cause instanceof Error ? cause.message : cause));
    io.stderr(USAGE);
    return Promise.resolve(EXIT_USAGE);
  }

  switch (command) {
    case "validate":
      return Promise.resolve(commandValidate(options, io, overrides));
    case "run":
      return commandRun(options, io, overrides);
    case "list":
      return Promise.resolve(commandList(options, io, overrides));
    default:
      io.stderr(`unknown command: ${command}`);
      io.stderr(USAGE);
      return Promise.resolve(EXIT_USAGE);
  }
}

function parseOptions(tokens: string[]): Options {
  const options: Options = {};
  const flagToKey: Record<string, keyof Options> = {
    "--book": "book",
    "--axis": "axis",
    "--books-root": "booksRoot",
    "--runs": "runs",
    "--judge": "judge",
    "--format": "format",
    "--gates": "gates",
    "--pipeline": "pipeline",
    "--cache": "cache",
    "--log-level": "logLevel",
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) break;
    const key = flagToKey[token];
    if (!key) {
      throw new Error(`unexpected argument: ${token}`);
    }
    const value = tokens[i + 1];
    if (value === undefined) {
      throw new Error(`missing value for ${token}`);
    }
    options[key] = value;
    i++;
  }
  return options;
}

function booksRootOf(options: Options, overrides: RunCliOverrides): string {
  return options.booksRoot ?? overrides.booksRoot ?? defaultBooksRoot;
}

function printValidationSuccess(io: CliIo, id: string, chapters: number): void {
  io.stdout(`${id}: OK`);
  io.stdout(`  chapters: ${chapters} (ordinals contiguous from 1)`);
}

function printValidationErrors(
  io: CliIo,
  id: string,
  errors: readonly (ValidationError | { code: string; message: string })[],
): void {
  io.stderr(`${id}: INVALID (${errors.length} error${errors.length === 1 ? "" : "s"})`);
  for (const error of errors) {
    io.stderr(`  [${error.code}] ${error.message}`);
  }
}

interface ValidatedBook {
  bookDir: string;
  manifest: BookManifest;
  chapters: ValidatedChapter[];
}

function validateOrReport(
  id: string,
  options: Options,
  io: CliIo,
  overrides: RunCliOverrides,
): ValidatedBook | null {
  const result = validateBook(join(booksRootOf(options, overrides), id));
  if (!result.ok) {
    printValidationErrors(io, id, result.errors);
    return null;
  }
  printValidationSuccess(io, id, result.chapters.length);
  return { bookDir: result.bookDir, manifest: result.manifest, chapters: result.chapters };
}

function isAxis(value: string | undefined): value is Axis {
  return AXES.includes(value as Axis);
}

type Format = (typeof FORMATS)[number];

/** Parses --cache (default true); anything but "true"/"false" is a usage error. */
function cacheEnabledOf(options: Options, io: CliIo): boolean | null {
  const raw = options.cache;
  if (raw === undefined) return true;
  if (raw === "true") return true;
  if (raw === "false") return false;
  io.stderr(`--cache must be one of true, false (got: ${raw})`);
  return null;
}

/** Parses --log-level (default "info"). Anything else is a usage error. */
function logLevelOf(options: Options, io: CliIo): LogLevel | null {
  const raw = options.logLevel ?? "info";
  if ((LOG_LEVELS as readonly string[]).includes(raw)) return raw as LogLevel;
  io.stderr(`--log-level must be one of ${LOG_LEVELS.join(", ")} (got: ${raw})`);
  return null;
}

/** Builds the level-filtered stderr logger the runner threads through ops. */
function buildLogger(io: CliIo, level: LogLevel): Logger {
  if (level === "off") {
    return { info: () => {}, debug: () => {} };
  }
  const inner = stderrLogger(io.stderr);
  return levelFilter(inner, level);
}

function isFormat(value: string): value is Format {
  return (FORMATS as readonly string[]).includes(value);
}

function commandValidate(
  options: Options,
  io: CliIo,
  overrides: RunCliOverrides,
): number {
  const id = options.book;
  if (!id) {
    io.stderr("missing required flag: --book <id>");
    io.stderr(USAGE);
    return EXIT_USAGE;
  }

  return validateOrReport(id, options, io, overrides) === null
    ? EXIT_VALIDATION_FAILED
    : EXIT_OK;
}

type AxisCommand = (
  book: LoadedBook,
  format: Format,
  options: Options,
  io: CliIo,
  overrides: RunCliOverrides,
  ops: PipelineOps,
  log: Logger,
) => Promise<number>;

const AXIS_COMMANDS: ReadonlyMap<Axis, AxisCommand> = new Map([
  ["extraction", runExtractionCommand],
  ["checker", runCheckerCommand],
  ["generation", runGenerationCommand],
]);

async function commandRun(
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

  const format = options.format ?? "text";
  if (!isFormat(format)) {
    io.stderr(`--format must be one of ${FORMATS.join(", ")} (got: ${options.format})`);
    return EXIT_USAGE;
  }

  const cacheEnabled = cacheEnabledOf(options, io);
  if (cacheEnabled === null) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  const logLevel = logLevelOf(options, io);
  if (logLevel === null) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }
  const log = buildLogger(io, logLevel);
  log.info(`log level: ${logLevel}`);
  // Always announced so cached-vs-fresh provenance of every report is
  // unambiguous from its own output. Machine-readable mode keeps stdout
  // pure JSON, so the announcement follows the validation-chatter pattern.
  const announce = (line: string): void =>
    format === "json" ? io.stderr(line) : io.stdout(line);
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
    format === "json" ? { stdout: () => {}, stderr: io.stderr } : io,
    overrides,
  );
  if (!result) {
    return EXIT_VALIDATION_FAILED;
  }

  const book: LoadedBook = { bookId: id, bookDir: result.bookDir, chapters: result.chapters };

  const command = AXIS_COMMANDS.get(options.axis);
  if (command !== undefined) {
    const ops = buildPipelineOps(options, io, overrides, cacheEnabled, log);
    if (ops === null) return EXIT_USAGE;
    return command(book, format, options, io, overrides, ops, log);
  }

  io.stdout(
    `axis "${options.axis}" has no pipeline registered yet; fixture ingestion and validation passed`,
  );
  io.stderr(
    `axis "${options.axis}" is not implemented yet (pipeline port lands with the harness work)`,
  );
  return EXIT_NOT_IMPLEMENTED;
}

interface LoadedBook {
  readonly bookId: string;
  readonly bookDir: string;
  readonly chapters: readonly ValidatedChapter[];
}

/** Wraps the judge in the persisted verdict cache unless caching is disabled. */
function wrapJudge(
  baseJudge: Judge,
  cacheEnabled: boolean,
  options: Options,
  overrides: RunCliOverrides,
  log: Logger,
): Judge {
  return cacheEnabled
    ? new CachingJudge(
        baseJudge,
        new FileVerdictCache(cachePathOf(options, overrides), log),
        log,
      )
    : baseJudge;
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
): Promise<number> {
  const assertions = loadAssertionSet(book.bookDir, { maxOrdinal: maxOrdinal(book.chapters) });
  if (!assertions.ok) {
    printValidationErrors(io, book.bookId, assertions.errors);
    return EXIT_VALIDATION_FAILED;
  }

  const gates = loadGateConfig(options, io);
  if (gates === null) return EXIT_USAGE;

  const runs = parseRunCount(options.runs);
  if (runs === null) {
    io.stderr("--runs must be an integer >= 1");
    return EXIT_USAGE;
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

  const report = await runExtractionAxis({
    bookId: book.bookId,
    chapters: book.chapters,
    assertions: assertions.set,
    extract: ops.extract,
    judge,
    gates,
    runs,
    log,
  });

  if (format === "json") {
    io.stdout(formatJsonReport(report));
  } else {
    for (const line of formatTextReport(report)) {
      io.stdout(line);
    }
  }

  return report.passed ? EXIT_OK : EXIT_GATE_FAILED;
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
  _options: Options,
  io: CliIo,
  _overrides: RunCliOverrides,
  ops: PipelineOps,
  _log: Logger,
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

  const report = await runCheckerAxis({
    bookId: book.bookId,
    chapters: book.chapters,
    cases: perturbations.cases,
    extract: ops.extract,
    check: ops.check,
  });

  if (format === "json") {
    io.stdout(formatCheckerJsonReport(report));
  } else {
    for (const line of formatCheckerTextReport(report)) {
      io.stdout(line);
    }
  }

  return report.passed ? EXIT_OK : EXIT_GATE_FAILED;
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

  const report = await runGenerationAxis({
    bookId: book.bookId,
    chapters: book.chapters,
    beats: beats.set,
    extract: ops.extract,
    generate: ops.generate,
    check: ops.check,
    judge,
  });

  if (format === "json") {
    io.stdout(formatGenerationJsonReport(report));
  } else {
    for (const line of formatGenerationTextReport(report)) {
      io.stdout(line);
    }
  }

  return report.passed ? EXIT_OK : EXIT_GATE_FAILED;
}

/**
 * Resolves the pipeline selection into concrete op implementations. Live is
 * the default (credential-gated via AGNES_API_KEY; AGNES_BASE_URL optional;
 * AGNES_MIN_INTERVAL_MS widens the fixed-interval throttle); `fake` stays
 * available as the fully-offline deterministic reference implementation.
 */
function buildPipelineOps(
  options: Options,
  io: CliIo,
  overrides: RunCliOverrides,
  cacheEnabled: boolean,
  log: Logger,
): PipelineOps | null {
  const selection = options.pipeline ?? "live";
  if (!(PIPELINES as readonly string[]).includes(selection)) {
    io.stderr(`--pipeline must be one of ${PIPELINES.join(", ")} (got: ${selection})`);
    return null;
  }
  if (selection === "fake") {
    log.info("pipeline: fake (offline deterministic reference)");
    return { extract: fakeExtract, check: fakeCheck, generate: fakeGenerate };
  }

  const apiKey = process.env.AGNES_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    io.stderr("the live pipeline requires AGNES_API_KEY in the environment");
    return null;
  }
  const minIntervalMs = minIntervalMsFromEnv(io);
  if (minIntervalMs === null) return null;

  const baseUrl = process.env.AGNES_BASE_URL;
  const agnesClient = createAgnesClient({
    apiKey,
    ...(baseUrl !== undefined && baseUrl.trim().length > 0 ? { baseUrl } : {}),
    ...(minIntervalMs !== undefined ? { minIntervalMs } : {}),
    log,
  });
  return {
    agnesClient,
    // Extraction response cache (temp-0 requests are input-deterministic;
    // hits re-validate at the trust boundary, prompt changes re-key). Check
    // stays uncached — per-run case count is small — and generate is never
    // cached because sampled prose is the thing being measured. All of it
    // is off when --cache false forces fresh API traffic.
    extract: cacheEnabled
      ? createAgnesExtract(agnesClient, {
          responseCache: new FileResponseCache(extractCachePathOf(options, overrides), log),
          log,
        })
      : createAgnesExtract(agnesClient, { log }),
    check: createAgnesCheck(agnesClient),
    generate: createAgnesGenerate(agnesClient),
  };
}

/** Free-tier throttling can vary per key; operators may widen the spacing. */
function minIntervalMsFromEnv(io: CliIo): number | undefined | null {
  const raw = process.env.AGNES_MIN_INTERVAL_MS;
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    io.stderr("AGNES_MIN_INTERVAL_MS must be a non-negative integer of milliseconds");
    return null;
  }
  return value;
}

function loadGateConfig(options: Options, io: CliIo): GateConfig | null {
  if (options.gates === undefined) return DEFAULT_GATES;
  if (!existsSync(options.gates)) {
    io.stderr(`gates file not found: ${options.gates}`);
    return null;
  }
  try {
    return parseGateConfig(JSON.parse(readFileSync(options.gates, "utf8")));
  } catch (cause) {
    io.stderr(
      `invalid gates file ${options.gates}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return null;
  }
}

function parseRunCount(raw: string | undefined): number | null {
  if (raw === undefined) return RUNS_PER_BOOK;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : null;
}

function selectJudge(
  selection: string,
  io: CliIo,
  sharedClient?: AgnesClient,
  log: Logger = { info: () => {}, debug: () => {} },
): Judge | null {
  if (!(JUDGES as readonly string[]).includes(selection)) {
    io.stderr(`--judge must be one of ${JUDGES.join(", ")} (got: ${selection})`);
    return null;
  }
  if (selection === "stub") {
    log.info("judge: stub (offline deterministic)");
    return createStubJudge();
  }

  log.info("judge: live (Agnes-backed)");
  if (sharedClient !== undefined) return createLiveJudge({ client: sharedClient, log });

  const apiKey = process.env.AGNES_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    io.stderr("the live judge requires AGNES_API_KEY in the environment");
    return null;
  }
  const baseUrl = process.env.AGNES_BASE_URL;
  return createLiveJudge({
    apiKey,
    ...(baseUrl !== undefined && baseUrl.trim().length > 0 ? { baseUrl } : {}),
    log,
  });
}

function cachePathOf(options: Options, overrides: RunCliOverrides): string {
  return (
    overrides.judgeCachePath ??
    join(booksRootOf(options, overrides), "..", "results", "cache", "judge-cache.json")
  );
}

function extractCachePathOf(options: Options, overrides: RunCliOverrides): string {
  return (
    overrides.extractCachePath ??
    join(booksRootOf(options, overrides), "..", "results", "cache", "extract-cache.json")
  );
}

function commandList(
  options: Options,
  io: CliIo,
  overrides: RunCliOverrides,
): number {
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
