#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "./runner.js";

/**
 * Loads benchmarks/.env (AGNES_API_KEY, AGNES_BASE_URL, AGNES_MIN_INTERVAL_MS)
 * relative to the package directory so cwd never matters. Absent file is fine
 * — env vars may be exported directly. Never loaded by library modules or
 * tests, which wire their own environment explicitly.
 */
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(packageRoot, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

runCli(process.argv.slice(2), {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
})
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((cause: unknown) => {
    console.error(cause instanceof Error ? (cause.stack ?? cause.message) : String(cause));
    process.exitCode = 1;
  });
