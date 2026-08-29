import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Repository layout resolution for the dev server. The UI is a workspace
 * sibling of the benchmarks package, so every path is derived from a single
 * repo-root discovery — no cwd assumptions, no hardcoded absolute paths.
 */

export interface RepoPaths {
  readonly repoRoot: string;
  readonly benchmarksRoot: string;
  /** The compiled CLI the run manager spawns (`pnpm build:cli` produces it). */
  readonly cliEntry: string;
  readonly booksRoot: string;
  /** Gitignored persistence area for UI run records. */
  readonly uiRunsDir: string;
  /** The benchmarks .env the CLI loads for live runs. */
  readonly envFile: string;
}

/** Walks up from `start` to the directory containing benchmarks/package.json. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "benchmarks", "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `could not locate the repo root (a benchmarks/package.json ancestor of ${start})`,
      );
    }
    dir = parent;
  }
}

export function repoPaths(start?: string): RepoPaths {
  const repoRoot = findRepoRoot(start);
  const benchmarksRoot = join(repoRoot, "benchmarks");
  return {
    repoRoot,
    benchmarksRoot,
    cliEntry: join(benchmarksRoot, "dist", "runner", "cli.js"),
    booksRoot: join(benchmarksRoot, "books"),
    uiRunsDir: join(benchmarksRoot, "results", "ui-runs"),
    envFile: join(benchmarksRoot, ".env"),
  };
}
