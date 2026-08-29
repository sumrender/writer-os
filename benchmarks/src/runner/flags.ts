import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_GATES, parseGateConfig, type GateConfig } from "../lib/gates.js";
import { RUNS_PER_BOOK } from "../lib/metrics.js";
import { SYNTHESIS_STRATEGIES, type SynthesisStrategy } from "../lib/pipeline.js";
import { levelFilter, stderrLogger, type Logger, type LogLevel } from "../lib/logger.js";
import { FORMATS, LOG_LEVELS, type CliIo, type Format, type RunCliOverrides } from "./types.js";

/**
 * Everything argv: the parsed flag bag plus every flag-parsing helper. This
 * is the only module that knows how CLI strings become typed options; the
 * commands consume the results without re-parsing anything.
 */

export interface Options {
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
  synthesis?: string;
}

/** Fixture books root `--books-root` resolves against; cwd never matters. */
export const defaultBooksRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "books",
);

export function parseOptions(tokens: string[]): Options {
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
    "--synthesis": "synthesis",
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

export function booksRootOf(options: Options, overrides: RunCliOverrides): string {
  return options.booksRoot ?? overrides.booksRoot ?? defaultBooksRoot;
}

/** Parses --cache (default true); anything but "true"/"false" is a usage error. */
export function cacheEnabledOf(options: Options, io: CliIo): boolean | null {
  const raw = options.cache;
  if (raw === undefined) return true;
  if (raw === "true") return true;
  if (raw === "false") return false;
  io.stderr(`--cache must be one of true, false (got: ${raw})`);
  return null;
}

/**
 * Parses --synthesis (default "per-section"); anything else is a usage
 * error. The strategy selects how the bible synthesis composes its calls
 * (issue #14) and rides in the synthesis cache keys.
 */
export function synthesisStrategyOf(options: Options, io: CliIo): SynthesisStrategy | null {
  const raw = options.synthesis;
  if (raw === undefined) return "per-section";
  if ((SYNTHESIS_STRATEGIES as readonly string[]).includes(raw)) {
    return raw as SynthesisStrategy;
  }
  io.stderr(`--synthesis must be one of ${SYNTHESIS_STRATEGIES.join(", ")} (got: ${raw})`);
  return null;
}

/** Parses --log-level (default "info"). Anything else is a usage error. */
export function logLevelOf(options: Options, io: CliIo): LogLevel | null {
  const raw = options.logLevel ?? "info";
  if ((LOG_LEVELS as readonly string[]).includes(raw)) return raw as LogLevel;
  io.stderr(`--log-level must be one of ${LOG_LEVELS.join(", ")} (got: ${raw})`);
  return null;
}

/** Builds the level-filtered stderr logger the commands thread through ops. */
export function buildLogger(io: CliIo, level: LogLevel): Logger {
  if (level === "off") {
    return { info: () => {}, debug: () => {} };
  }
  const inner = stderrLogger(io.stderr);
  return levelFilter(inner, level);
}

export function isFormat(value: string): value is Format {
  return (FORMATS as readonly string[]).includes(value);
}

/** Free-tier throttling can vary per key; operators may widen the spacing. */
export function minIntervalMsFromEnv(io: CliIo): number | undefined | null {
  const raw = process.env.AGNES_MIN_INTERVAL_MS;
  if (raw === undefined || raw.trim().length === 0) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    io.stderr("AGNES_MIN_INTERVAL_MS must be a non-negative integer of milliseconds");
    return null;
  }
  return value;
}

export function loadGateConfig(options: Options, io: CliIo): GateConfig | null {
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

export function parseRunCount(raw: string | undefined): number | null {
  if (raw === undefined) return RUNS_PER_BOOK;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : null;
}
