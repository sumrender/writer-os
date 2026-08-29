import { repoPaths } from "./paths.js";
import { createRunManager, type RunManager } from "./run-manager.js";

/**
 * The single run-manager instance for the dev server. Lives in a `.server.ts`
 * module so the Start compiler keeps it (and its child-process state) out of
 * the client bundle, and so module-level state holds exactly one active run
 * across every server-function invocation. Paths are resolved once from the
 * repo layout; the environment passes through so live runs reuse the CLI's
 * existing `.env` handling.
 */
const paths = repoPaths();

export const runManager: RunManager = createRunManager({
  cliEntry: paths.cliEntry,
  booksRoot: paths.booksRoot,
  uiRunsDir: paths.uiRunsDir,
});

export const serverPaths = paths;
