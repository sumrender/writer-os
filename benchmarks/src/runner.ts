import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBook, type ValidationResult, type ValidationError } from "./lib/manifest.js";

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export const EXIT_OK = 0;
export const EXIT_VALIDATION_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_NOT_IMPLEMENTED = 3;

const AXES = ["extraction", "checker", "generation"] as const;
type Axis = (typeof AXES)[number];

const USAGE = `usage:
  bench validate --book <id> [--books-root <dir>]
  bench run --book <id> --axis <extraction|checker|generation> [--books-root <dir>]
  bench list [--books-root <dir>]
  bench help`;

const defaultBooksRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "books",
);

interface Options {
  book?: string;
  axis?: string;
  booksRoot?: string;
}

export function runCli(
  argv: string[],
  io: CliIo,
  overrides: { booksRoot?: string } = {},
): number {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    io.stdout(USAGE);
    return EXIT_OK;
  }

  const [command, ...rest] = argv;
  let options: Options;
  try {
    options = parseOptions(rest);
  } catch (cause) {
    io.stderr(String(cause instanceof Error ? cause.message : cause));
    io.stderr(USAGE);
    return EXIT_USAGE;
  }

  switch (command) {
    case "validate":
      return commandValidate(options, io, overrides);
    case "run":
      return commandRun(options, io, overrides);
    case "list":
      return commandList(options, io, overrides);
    default:
      io.stderr(`unknown command: ${command}`);
      io.stderr(USAGE);
      return EXIT_USAGE;
  }
}

function parseOptions(tokens: string[]): Options {
  const options: Options = {};
  const flagToKey: Record<string, keyof Options> = {
    "--book": "book",
    "--axis": "axis",
    "--books-root": "booksRoot",
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

function booksRootOf(options: Options, overrides: { booksRoot?: string }): string {
  return options.booksRoot ?? overrides.booksRoot ?? defaultBooksRoot;
}

function requireBook(options: Options, io: CliIo): string | undefined {
  if (!options.book) {
    io.stderr("missing required flag: --book <id>");
    return undefined;
  }
  return options.book;
}

function printValidationSuccess(io: CliIo, id: string, chapters: number): void {
  io.stdout(`${id}: OK`);
  io.stdout(`  chapters: ${chapters} (ordinals contiguous from 1)`);
}

function printValidationErrors(io: CliIo, id: string, errors: ValidationError[]): void {
  io.stderr(`${id}: INVALID (${errors.length} error${errors.length === 1 ? "" : "s"})`);
  for (const error of errors) {
    io.stderr(`  [${error.code}] ${error.message}`);
  }
}

type BooksRootOverrides = { booksRoot?: string };

function validateOrReport(
  id: string,
  options: Options,
  io: CliIo,
  overrides: BooksRootOverrides,
): ValidationResult | null {
  const result = validateBook(join(booksRootOf(options, overrides), id));
  if (!result.ok) {
    printValidationErrors(io, id, result.errors);
    return null;
  }
  printValidationSuccess(io, id, result.chapters.length);
  return result;
}

function isAxis(value: string | undefined): value is Axis {
  return AXES.includes(value as Axis);
}

function commandValidate(
  options: Options,
  io: CliIo,
  overrides: BooksRootOverrides,
): number {
  const id = requireBook(options, io);
  if (!id) {
    io.stderr(USAGE);
    return EXIT_USAGE;
  }

  return validateOrReport(id, options, io, overrides) === null
    ? EXIT_VALIDATION_FAILED
    : EXIT_OK;
}

function commandRun(
  options: Options,
  io: CliIo,
  overrides: BooksRootOverrides,
): number {
  const id = requireBook(options, io);
  if (!id) {
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

  const result = validateOrReport(id, options, io, overrides);
  if (!result) {
    return EXIT_VALIDATION_FAILED;
  }

  io.stdout(
    `axis "${options.axis}" has no pipeline registered yet; fixture ingestion and validation passed`,
  );
  io.stderr(
    `axis "${options.axis}" is not implemented yet (pipeline port lands with the harness work)`,
  );
  return EXIT_NOT_IMPLEMENTED;
}

function commandList(
  options: Options,
  io: CliIo,
  overrides: BooksRootOverrides,
): number {
  const root = booksRootOf(options, overrides);
  let anyInvalid = false;

  for (const entry of readdirSync(root).sort()) {
    const bookDir = join(root, entry);
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
