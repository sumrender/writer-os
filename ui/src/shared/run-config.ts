import { isPlainObject } from "@writer-os/benchmark/events";
import type { JudgeKind, PipelineKind } from "./enums.js";

/**
 * The Benchmark run configuration the UI form collects, and its validation —
 * one definition shared by the client form (immediate feedback) and the
 * server function validator (the actual gate: an invalid config never
 * reaches the run manager, per issue #10's story "client- and server-side
 * validation"). Data crossing the network boundary is narrowed from `unknown`
 * here before use (CODING_STANDARDS §1.5).
 */

export interface RunConfig {
  readonly book: string;
  /** v1 wires the Extraction axis only; the others are listed but disabled. */
  readonly axis: "extraction";
  readonly runs: number;
  readonly pipeline: PipelineKind;
  readonly judge: JudgeKind;
  readonly cache: boolean;
}

/** Field-level validation errors keyed by form field name. */
export type ConfigErrors = Partial<Record<keyof RunConfig, string>>;

export interface ConfigValidation {
  readonly config: RunConfig | null;
  readonly errors: ConfigErrors;
}

/** The offline-first defaults: mini-book through the deterministic fakes. */
export const DEFAULT_RUN_CONFIG: RunConfig = {
  book: "mini-book",
  axis: "extraction",
  runs: 1,
  pipeline: "fake",
  judge: "stub",
  cache: true,
};

function validateFormFields(fields: {
  book: string;
  axis: string;
  runs: string;
  pipeline: string;
  judge: string;
  cache: string;
}): ConfigValidation {
  const errors: ConfigErrors = {};

  const book = fields.book.trim().length > 0 ? fields.book : null;
  if (book === null) errors.book = "Pick a Fixture book.";

  const axis: "extraction" | null = fields.axis === "extraction" ? "extraction" : null;
  if (axis === null) errors.axis = "Only Extraction is enabled in v1.";

  const runs = Number(fields.runs);
  const runsValid = Number.isInteger(runs) && runs >= 1;
  if (!runsValid) errors.runs = "Runs must be an integer >= 1.";

  const pipeline: PipelineKind | null =
    fields.pipeline === "live" || fields.pipeline === "fake" ? fields.pipeline : null;
  if (pipeline === null) errors.pipeline = "Pipeline must be live or fake.";

  const judge: JudgeKind | null =
    fields.judge === "stub" || fields.judge === "live" ? fields.judge : null;
  if (judge === null) errors.judge = "Judge must be stub or live.";

  const cache: boolean | null =
    fields.cache === "true" ? true : fields.cache === "false" ? false : null;
  if (cache === null) errors.cache = "Cache must be true or false.";

  if (
    book === null ||
    axis === null ||
    !runsValid ||
    pipeline === null ||
    judge === null ||
    cache === null
  ) {
    return { config: null, errors };
  }
  return { config: { book, axis, runs, pipeline, judge, cache }, errors: {} };
}

/** Validates the raw form field bag (strings, as an HTML form submits them). */
export function validateRunForm(raw: Record<string, string | undefined>): ConfigValidation {
  return validateFormFields({
    book: raw["book"] ?? "",
    axis: raw["axis"] ?? "",
    runs: raw["runs"] ?? "",
    pipeline: raw["pipeline"] ?? "",
    judge: raw["judge"] ?? "",
    cache: raw["cache"] ?? "",
  });
}

/** Narrows an unknown network payload into a validated RunConfig. */
export function parseRunConfig(raw: unknown): ConfigValidation {
  if (!isPlainObject(raw)) {
    return { config: null, errors: { book: "Expected a run configuration object." } };
  }
  const record = raw;
  const asField = (key: string): string => {
    const value = record[key];
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "";
  };
  return validateFormFields({
    book: asField("book"),
    axis: asField("axis"),
    runs: asField("runs"),
    pipeline: asField("pipeline"),
    judge: asField("judge"),
    cache: asField("cache"),
  });
}

/** True when a live pipeline or live judge would spend API quota. */
export function isLiveConfig(config: RunConfig): boolean {
  return config.pipeline === "live" || config.judge === "live";
}
