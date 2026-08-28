/**
 * Shared vocabulary for the runner layer: selection enums, the io sink, and
 * exit codes. One source of truth consumed by both the CLI engine and the
 * config-driven chain, so the two entry modes can never drift apart.
 */

/** The io seam every runner command writes through; tests capture it. */
export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** Existing exit-code semantics (docs/TESTING.md §9.5). */
export const EXIT_OK = 0;
export const EXIT_VALIDATION_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_NOT_IMPLEMENTED = 3;
export const EXIT_GATE_FAILED = 4;

export const AXES = ["extraction", "checker", "generation"] as const;
export type Axis = (typeof AXES)[number];

export const JUDGES = ["stub", "live"] as const;
export type JudgeKind = (typeof JUDGES)[number];

export const FORMATS = ["text", "json"] as const;
export type Format = (typeof FORMATS)[number];

export const PIPELINES = ["live", "fake"] as const;
export type PipelineKind = (typeof PIPELINES)[number];

export const LOG_LEVELS = ["off", "info", "debug"] as const;

/**
 * Per-invocation path overrides the CLI resolves before its own defaults:
 * fixture books root, plus injected cache paths so tests can sandbox cache
 * writes away from the repository.
 */
export interface RunCliOverrides {
  booksRoot?: string;
  /** Injected by tests so cache writes never leave the sandbox. */
  judgeCachePath?: string;
  /** Injected by tests so extraction cache writes never leave the sandbox. */
  extractCachePath?: string;
}
