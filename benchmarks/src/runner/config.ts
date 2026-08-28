import type { GateConfig } from "../lib/gates.js";
import type { Axis, JudgeKind, PipelineKind } from "./types.js";

/**
 * The config-driven chain's declarative layer: what to run, not how. Edit
 * {@link DEFAULT_BENCHMARK_CONFIG} and execute it with `pnpm start`; every
 * run still delegates to the same engine plumbing the CLI commands use.
 */

/** Gate floors: an inline {@link GateConfig}, or a path to a JSON gates file (CLI wire format). */
export type GatesSelection = GateConfig | { readonly gatesFile: string };

/** One fixture book to benchmark, with optional per-book overrides of the global settings. */
export interface BookConfig {
  /** Fixture directory name under the books root, e.g. "tom-sawyer". */
  readonly id: string;
  /** Per-book axis override; falls back to the global `axes`. */
  readonly axes?: readonly Axis[];
  /** Per-book run-count override; falls back to the global `runs`. */
  readonly runs?: number;
  /** Per-book pipeline override; falls back to the global `pipeline`. */
  readonly pipeline?: PipelineKind;
  /** Per-book judge override; falls back to the global `judge`. */
  readonly judge?: JudgeKind;
  /** Per-book gate floors override; falls back to the global `gates`. */
  readonly gates?: GatesSelection;
}

export interface BenchmarkConfig {
  /** Books to benchmark, in execution order (outer loop). */
  readonly books: readonly BookConfig[];

  /** Default runs per book per axis; each run re-extracts the whole book. Default 3. */
  readonly runs: number;

  /** Which axes to run per book, in execution order (inner loop). */
  readonly axes: readonly Axis[];

  /** "live" = Agnes-backed ops (AGNES_API_KEY required); "fake" = deterministic, fully offline. */
  readonly pipeline: PipelineKind;

  /** "stub" = offline scripted judge; "live" = Agnes-backed equivalence judge (ADR-0005). */
  readonly judge: JudgeKind;

  /** AI client settings. All optional — fall back to benchmarks/.env / exported environment. */
  readonly agnes: {
    /** Overrides AGNES_API_KEY when set. */
    readonly apiKey?: string;
    /** Overrides AGNES_BASE_URL when set. */
    readonly baseUrl?: string;
    /** Rate-limit spacing in ms between request starts; overrides AGNES_MIN_INTERVAL_MS. */
    readonly minIntervalMs?: number;
  };

  /** Cache settings for judge verdicts and extraction responses. */
  readonly cache: {
    /** Default true. False forces every model call to reach the API fresh. */
    readonly enabled: boolean;
    /** Default results/cache/judge-cache.json (resolved against the books root). */
    readonly judgeCachePath?: string;
    /** Default results/cache/extract-cache.json (resolved against the books root). */
    readonly extractCachePath?: string;
  };

  /** Extraction gate floors. Omit for the lenient defaults (global precision ≥ 0.5). */
  readonly gates?: GatesSelection;

  /** Fixture books root. Default: benchmarks/books. */
  readonly booksRoot?: string;

  /** Report format per run. Default "text". */
  readonly format: "text" | "json";

  /** Progress logging on stderr. Default "info". */
  readonly logLevel: "off" | "info" | "debug";

  /** Validate every selected book before running anything; abort the chain on the first bad fixture. Default true. */
  readonly validateFirst: boolean;

  /** Stop the chain at the first nonzero-exit run instead of continuing. Default false. */
  readonly stopOnFailure: boolean;

  /** Save each run's report under `runsDir` + append START/END lines to its index.txt. Default true. */
  readonly logToFiles: boolean;

  /** Run-log directory. Default: benchmarks/results/runs. */
  readonly runsDir?: string;
}

/**
 * The configuration you edit. Defaults benchmark tom-sawyer +
 * gullivers-travels on the extraction axis with the live pipeline and the
 * offline stub judge — flip `judge` to "live" for judged grading, add axes,
 * or trim `books` to just `[{ id: "tom-sawyer" }]` to start smaller.
 */
export const DEFAULT_BENCHMARK_CONFIG: BenchmarkConfig = {
  // Books to run, in order. Each entry may override axes/runs/pipeline/judge/gates.
  books: [{ id: "tom-sawyer" }, { id: "gullivers-travels" }],

  // Sequential extraction passes per book per axis; metrics report mean ± variance.
  runs: 3,

  // Which axes to run: see AXES in types.ts.
  axes: ["extraction"],

  // "live" sends every op through Agnes (AGNES_API_KEY required);
  // "fake" is deterministic and fully offline.
  pipeline: "live",

  // "stub" grades offline deterministically; "live" asks the Agnes-backed
  // equivalence judge (cached by input hash).
  judge: "stub",

  // Explicit client overrides — usually leave empty and use benchmarks/.env.
  agnes: {
    // apiKey: "...",
    // baseUrl: "...",
    // minIntervalMs: 3500,
  },

  // Judge verdicts + extraction responses persist by input hash when enabled.
  cache: {
    enabled: true,
    // judgeCachePath: "…/judge-cache.json",
    // extractCachePath: "…/extract-cache.json",
  },

  // Extraction gate floors. Either an inline object
  // ({ globalPrecisionMin: 0.5, recallMin: { character: 0.8 } }) or a JSON
  // file ({ gatesFile: "gates.json" }). Omit for lenient defaults.
  // gates: { gatesFile: "gates.json" },

  // Report format: "text" (human) or "json" (machine, pure-JSON stdout).
  format: "text",

  // "off" | "info" | "debug" — debug logs every API call and cache lookup.
  logLevel: "info",

  // Validate all fixtures first and abort before any paid run on failure.
  validateFirst: true,

  // Keep going when a run fails; set true to bail at the first failure.
  stopOnFailure: false,

  // Write one report per run under results/runs/ plus an index.txt ledger.
  logToFiles: true,
};

