import { join } from "node:path";
import {
  validateBook,
  type BookManifest,
  type ValidationError,
  type ValidatedChapter,
} from "../lib/manifest.js";
import { EXIT_OK, EXIT_USAGE, EXIT_VALIDATION_FAILED, type CliIo, type RunCliOverrides } from "./types.js";
import { booksRootOf, type Options } from "./flags.js";
import { USAGE } from "./usage.js";

/**
 * Fixture validation concerns: loading a book directory, reporting its
 * health, and the `validate` command that guards every other entry point.
 */

export interface LoadedBook {
  readonly bookId: string;
  readonly bookDir: string;
  readonly chapters: readonly ValidatedChapter[];
}

interface ValidatedBook {
  bookDir: string;
  manifest: BookManifest;
  chapters: ValidatedChapter[];
}

export function printValidationSuccess(io: CliIo, id: string, chapters: number): void {
  io.stdout(`${id}: OK`);
  io.stdout(`  chapters: ${chapters} (ordinals contiguous from 1)`);
}

export function printValidationErrors(
  io: CliIo,
  id: string,
  errors: readonly (ValidationError | { code: string; message: string })[],
): void {
  io.stderr(`${id}: INVALID (${errors.length} error${errors.length === 1 ? "" : "s"})`);
  for (const error of errors) {
    io.stderr(`  [${error.code}] ${error.message}`);
  }
}

export function validateOrReport(
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

export function commandValidate(options: Options, io: CliIo, overrides: RunCliOverrides): number {
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
