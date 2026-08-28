/**
 * Run-time observability seam. A Logger is a single sink the runner wires
 * through the axis + lib call chain so progress is visible at every level
 * (CLI → axis → run → chapter → API call → cache lookup). The default
 * {@link silentLogger} is the no-op used by every test and library caller
 * that does not opt in, so introducing the seam never forces a change at
 * existing call sites.
 *
 * Levels are coarse on purpose: `info` is the human-friendly phase trace
 * (run start, per-chapter, per-assertion verdict), `debug` adds every
 * underlying API call and cache hit/miss. The CLI defaults to `info` and
 * exposes `--log-level` for finer control.
 */

export type LogLevel = "off" | "info" | "debug";

export interface Logger {
  /** Always emitted; phase-level progress. */
  info(line: string): void;
  /** Verbose; one line per underlying API call / cache lookup / retry. */
  debug(line: string): void;
}

/** The default sink: takes the parameter, does nothing. */
export const silentLogger: Logger = {
  info: () => {},
  debug: () => {},
};

/** A sink that prepends a level tag and delegates to a single writer. */
export function stderrLogger(write: (line: string) => void): Logger {
  return {
    info: (line) => write(`[info] ${line}`),
    debug: (line) => write(`[debug] ${line}`),
  };
}

/** A guard that drops anything below `minLevel`. */
export function levelFilter(inner: Logger, minLevel: LogLevel): Logger {
  const allow = { off: 0, info: 1, debug: 2 } as const;
  const threshold = allow[minLevel];
  return {
    info: (line) => {
      if (threshold >= 1) inner.info(line);
    },
    debug: (line) => {
      if (threshold >= 2) inner.debug(line);
    },
  };
}
