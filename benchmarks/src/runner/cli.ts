#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_BENCHMARK_CONFIG } from "./config.js";
import { consoleIo, packageRoot, runBenchmark } from "./chain.js";
import { runCli } from "./engine.js";
import { EXIT_OK } from "./types.js";

/**
 * Process entry for the runner layer. Two modes:
 *
 * - `node dist/runner/cli.js` (no arguments) — executes the configured
 *   benchmark chain (DEFAULT_BENCHMARK_CONFIG in config.ts). This is what
 *   `pnpm start` runs.
 * - `node dist/runner/cli.js <subcommand> …` — forwards to the CLI engine
 *   (`run` / `validate` / `list` / `help`) for ad-hoc single commands.
 *
 * Loads benchmarks/.env (AGNES_API_KEY, AGNES_BASE_URL, AGNES_MIN_INTERVAL_MS)
 * relative to the package directory so cwd never matters. Absent file is fine
 * — env vars may be exported directly. Never loaded by library modules or
 * tests, which wire their own environment explicitly.
 */

async function main(): Promise<void> {
  const envPath = join(packageRoot(), ".env");
  if (existsSync(envPath)) process.loadEnvFile(envPath);

  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    try {
      const summary = await runBenchmark(DEFAULT_BENCHMARK_CONFIG);
      process.exitCode = summary.allPassed
        ? EXIT_OK
        : (summary.results.find((r) => r.exitCode !== EXIT_OK)?.exitCode ?? 1);
    } catch (cause: unknown) {
      console.error(cause instanceof Error ? cause.message : String(cause));
      process.exitCode = 2;
    }
    return;
  }

  runCli(argv, consoleIo)
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((cause: unknown) => {
      console.error(cause instanceof Error ? (cause.stack ?? cause.message) : String(cause));
      process.exitCode = 1;
    });
}

const entryHref =
  process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href;
if (import.meta.url === entryHref) {
  void main();
}