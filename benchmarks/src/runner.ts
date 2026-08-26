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
import { DEFAULT_GATES, parseGateConfig, type GateConfig } from "./lib/gates.js";
import type { Judge } from "./lib/judge.js";
import { createStubJudge } from "./lib/stub-judge.js";
import { createLiveJudge } from "./lib/live-judge.js";
import { CachingJudge } from "./lib/cached-judge.js";
import { FileVerdictCache } from "./lib/verdict-cache.js";
import { fakeCheck, fakeExtract } from "./lib/fakes.js";
import { loadPerturbationSet } from "./lib/perturbation-file.js";
import { RUNS_PER_BOOK } from "./lib/metrics.js";
import { runExtractionAxis } from "./extraction-axis.js";
import { runCheckerAxis } from "./checker-axis.js";
import {
  formatCheckerJsonReport,
  formatCheckerTextReport,
  formatJsonReport,
  formatTextReport,
} from "./report.js";

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

const USAGE = `usage:
  bench validate --book <id> [--books-root <dir>]
  bench run --book <id> --axis <extraction|checker|generation>
            [--runs <n>] [--judge <stub|live>] [--format <text|json>] [--gates <file>]
            [--books-root <dir>]
  bench list [--books-root <dir>]
  bench help

extraction defaults: ${RUNS_PER_BOOK} runs · stub judge (offline) · text report · lenient gates
live judging reads AGNES_API_KEY (and optional AGNES_BASE_URL); verdicts cache by input hash.`;

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
}

export interface RunCliOverrides {
  booksRoot?: string;
  /** Injected by tests so cache writes never leave the sandbox. */
  judgeCachePath?: string;
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

  if (options.axis === "extraction") {
    return runExtractionCommand(book, format, options, io, overrides);
  }
  if (options.axis === "checker") {
    return runCheckerCommand(book, format, io);
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

  const baseJudge = selectJudge(options.judge ?? "stub", io);
  if (baseJudge === null) return EXIT_USAGE;

  const judge = new CachingJudge(baseJudge, new FileVerdictCache(cachePathOf(options, overrides)));

  const report = await runExtractionAxis({
    bookId: book.bookId,
    chapters: book.chapters,
    assertions: assertions.set,
    extract: fakeExtract,
    judge,
    gates,
    runs,
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
  io: CliIo,
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
    extract: fakeExtract,
    check: fakeCheck,
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

function selectJudge(selection: string, io: CliIo): Judge | null {
  if (!(JUDGES as readonly string[]).includes(selection)) {
    io.stderr(`--judge must be one of ${JUDGES.join(", ")} (got: ${selection})`);
    return null;
  }
  if (selection === "stub") return createStubJudge();

  const apiKey = process.env.AGNES_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    io.stderr("the live judge requires AGNES_API_KEY in the environment");
    return null;
  }
  const baseUrl = process.env.AGNES_BASE_URL;
  return createLiveJudge({
    apiKey,
    ...(baseUrl !== undefined && baseUrl.trim().length > 0 ? { baseUrl } : {}),
  });
}

function cachePathOf(options: Options, overrides: RunCliOverrides): string {
  return (
    overrides.judgeCachePath ??
    join(booksRootOf(options, overrides), "..", "results", "cache", "judge-cache.json")
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
