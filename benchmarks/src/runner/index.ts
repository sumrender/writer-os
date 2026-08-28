/**
 * Public API of the runner layer. Library/test callers import from here
 * (`./runner/index.js`) instead of reaching into individual modules, so the
 * internal file layout stays free to evolve.
 */

export { runCli } from "./engine.js";
export {
  AXES,
  EXIT_OK,
  EXIT_VALIDATION_FAILED,
  EXIT_USAGE,
  EXIT_NOT_IMPLEMENTED,
  EXIT_GATE_FAILED,
  FORMATS,
  JUDGES,
  LOG_LEVELS,
  PIPELINES,
  type Axis,
  type CliIo,
  type Format,
  type JudgeKind,
  type PipelineKind,
  type RunCliOverrides,
} from "./types.js";
export {
  DEFAULT_BENCHMARK_CONFIG,
  type BenchmarkConfig,
  type BookConfig,
  type GatesSelection,
} from "./config.js";
export { consoleIo, packageRoot, runBenchmark, type BenchmarkSummary, type RunResult } from "./chain.js";
