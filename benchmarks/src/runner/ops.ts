import { join } from "node:path";
import type { Judge } from "../lib/judge.js";
import { createStubJudge } from "../lib/stub-judge.js";
import { createLiveJudge } from "../lib/live-judge.js";
import { CachingJudge } from "../lib/cached-judge.js";
import { FileVerdictCache } from "../lib/verdict-cache.js";
import { fakeCheck, fakeExtract, fakeGenerate } from "../lib/fakes.js";
import { createAgnesClient, type AgnesClient } from "../lib/agnes-client.js";
import { createAgnesExtract } from "../lib/agnes-extract.js";
import { FileResponseCache } from "../lib/response-cache.js";
import { createAgnesCheck } from "../lib/agnes-check.js";
import { createAgnesGenerate } from "../lib/agnes-generate.js";
import type { Check, Extract, Generate } from "../lib/pipeline.js";
import type { Logger } from "../lib/logger.js";
import { JUDGES, PIPELINES, type CliIo, type RunCliOverrides } from "./types.js";
import { booksRootOf, minIntervalMsFromEnv, type Options } from "./flags.js";

/**
 * Pipeline/judge wiring concerns: resolving a pipeline or judge selection
 * into concrete implementations, and wrapping them in the persisted caches.
 * The commands consume resolved ops without knowing any vendor detail.
 */

/**
 * The registered operation implementations per selection: vendor-backed
 * (default) or deterministic fakes (`--pipeline fake`, fully offline). One
 * AgnesClient backs every live op, so rate-limit spacing stays global even
 * when judge verdicts interleave with pipeline traffic.
 */
export interface PipelineOps {
  readonly extract: Extract;
  readonly check: Check;
  readonly generate: Generate;
  /** Present exactly when the ops share their client with the judge seam. */
  readonly agnesClient?: AgnesClient;
}

/**
 * Resolves the pipeline selection into concrete op implementations. Live is
 * the default (credential-gated via AGNES_API_KEY; AGNES_BASE_URL optional;
 * AGNES_MIN_INTERVAL_MS widens the fixed-interval throttle); `fake` stays
 * available as the fully-offline deterministic reference implementation.
 */
export function buildPipelineOps(
  options: Options,
  io: CliIo,
  overrides: RunCliOverrides,
  cacheEnabled: boolean,
  log: Logger,
): PipelineOps | null {
  const selection = options.pipeline ?? "live";
  if (!(PIPELINES as readonly string[]).includes(selection)) {
    io.stderr(`--pipeline must be one of ${PIPELINES.join(", ")} (got: ${selection})`);
    return null;
  }
  if (selection === "fake") {
    log.info("pipeline: fake (offline deterministic reference)");
    return { extract: fakeExtract, check: fakeCheck, generate: fakeGenerate };
  }

  const apiKey = process.env.AGNES_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    io.stderr("the live pipeline requires AGNES_API_KEY in the environment");
    return null;
  }
  const minIntervalMs = minIntervalMsFromEnv(io);
  if (minIntervalMs === null) return null;

  const baseUrl = process.env.AGNES_BASE_URL;
  const agnesClient = createAgnesClient({
    apiKey,
    ...(baseUrl !== undefined && baseUrl.trim().length > 0 ? { baseUrl } : {}),
    ...(minIntervalMs !== undefined ? { minIntervalMs } : {}),
    log,
  });
  return {
    agnesClient,
    // Extraction response cache (temp-0 requests are input-deterministic;
    // hits re-validate at the trust boundary, prompt changes re-key). Check
    // stays uncached — per-run case count is small — and generate is never
    // cached because sampled prose is the thing being measured. All of it
    // is off when --cache false forces fresh API traffic.
    extract: cacheEnabled
      ? createAgnesExtract(agnesClient, {
          responseCache: new FileResponseCache(extractCachePathOf(options, overrides), log),
          log,
        })
      : createAgnesExtract(agnesClient, { log }),
    check: createAgnesCheck(agnesClient),
    generate: createAgnesGenerate(agnesClient),
  };
}

export function selectJudge(
  selection: string,
  io: CliIo,
  sharedClient?: AgnesClient,
  log: Logger = { info: () => {}, debug: () => {} },
): Judge | null {
  if (!(JUDGES as readonly string[]).includes(selection)) {
    io.stderr(`--judge must be one of ${JUDGES.join(", ")} (got: ${selection})`);
    return null;
  }
  if (selection === "stub") {
    log.info("judge: stub (offline deterministic)");
    return createStubJudge();
  }

  log.info("judge: live (Agnes-backed)");
  if (sharedClient !== undefined) return createLiveJudge({ client: sharedClient, log });

  const apiKey = process.env.AGNES_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    io.stderr("the live judge requires AGNES_API_KEY in the environment");
    return null;
  }
  const baseUrl = process.env.AGNES_BASE_URL;
  return createLiveJudge({
    apiKey,
    ...(baseUrl !== undefined && baseUrl.trim().length > 0 ? { baseUrl } : {}),
    log,
  });
}

/** Wraps the judge in the persisted verdict cache unless caching is disabled. */
export function wrapJudge(
  baseJudge: Judge,
  cacheEnabled: boolean,
  options: Options,
  overrides: RunCliOverrides,
  log: Logger,
): Judge {
  return cacheEnabled
    ? new CachingJudge(
        baseJudge,
        new FileVerdictCache(cachePathOf(options, overrides), log),
        log,
      )
    : baseJudge;
}

function cachePathOf(options: Options, overrides: RunCliOverrides): string {
  return (
    overrides.judgeCachePath ??
    join(booksRootOf(options, overrides), "..", "results", "cache", "judge-cache.json")
  );
}

function extractCachePathOf(options: Options, overrides: RunCliOverrides): string {
  return (
    overrides.extractCachePath ??
    join(booksRootOf(options, overrides), "..", "results", "cache", "extract-cache.json")
  );
}
