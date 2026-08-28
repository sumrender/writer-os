import OpenAI from "openai";
import { silentLogger, type Logger } from "./logger.js";

/**
 * The shared Agnes AI client (ADR-0004: OpenAI-compatible endpoint at
 * apihub.agnes-ai.com, model agnes-2.5-flash).
 *
 * Two verified platform constraints shape this module (Agnes model catalog
 * 2026-07-30 / doc "Limits and Pricing"):
 *   • Rate limits — free-tier "Actual Executable RPM" is 20 (public request
 *     RPM is 30, but only ~20 execute after server-side scheduling). Every
 *     call therefore passes through one serialized fixed-interval gate
 *     defaulting to 3500 ms between request starts (~17 RPM, real headroom).
 *   • Context window — 512K tokens with a 65.5K output ceiling; payloads are
 *     guarded before sending. Note the window can move (agnes-2.0-flash's
 *     temporary 1M was rolled back in June 2026), hence the named constant.
 *
 * Transport, clock, and sleeping are injectable so tests never touch the
 * network (dependency inversion, CODING_STANDARDS.md §3.5).
 */

export const DEFAULT_AGNES_MODEL = "agnes-2.5-flash";
export const AGNES_CONTEXT_WINDOW_TOKENS = 512_000;
export const AGNES_OUTPUT_RESERVE_TOKENS = 16_384;

/** 20 executable RPM ⇒ 3000 ms is exactly zero headroom; 3500 ms ≈ 17 RPM. */
export const DEFAULT_MIN_INTERVAL_MS = 3_500;

export const DEFAULT_MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

/** Catalog guidance: back off and retry on these; everything else fails fast. */
const RETRIABLE_STATUSES: ReadonlySet<number> = new Set([429, 500, 502, 503, 520]);

export interface ChatCompletionRequest {
  readonly system: string;
  readonly user: string;
  /** Tool definitions sent verbatim; requires `forceToolName`. */
  readonly tools?: readonly unknown[];
  /** When set, tool_choice forces exactly this tool (structured output path). */
  readonly forceToolName?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface SentRequest {
  readonly model: string;
  readonly body: Record<string, unknown>;
}

export type ChatTransport = (request: SentRequest) => Promise<unknown>;

export interface AgnesClientOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
  /** Minimum spacing between request starts, ms. Default 3,500 (~17 RPM). */
  readonly minIntervalMs?: number;
  /** Retries on retriable statuses (429/5xx per catalog). Default 3. */
  readonly maxRetries?: number;
  readonly retryBaseDelayMs?: number;
  /** Injectable transport; defaults to the OpenAI SDK against Agnes. */
  readonly send?: ChatTransport;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  /** Optional progress sink for network-level events. */
  readonly log?: Logger;
}

export function createAgnesClient(options: AgnesClientOptions): AgnesClient {
  if (options.apiKey.trim().length === 0) {
    throw new Error("the Agnes client requires an API key");
  }
  const model = options.model ?? DEFAULT_AGNES_MODEL;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = options.log ?? silentLogger;
  const retry: RetryOptions = {
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    retryBaseDelayMs: options.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS,
    sleep,
  };
  const transport: ChatTransport =
    options.send ??
    (async ({ model: sentModel, body }) => {
      const sdk = new OpenAI({
        apiKey: options.apiKey,
        ...(options.baseUrl !== undefined && options.baseUrl.trim().length > 0
          ? { baseURL: options.baseUrl }
          : {}),
      });
      // The Agnes gateway is OpenAI-compatible; the body is fully assembled
      // and controlled above, so a single justified boundary assertion bridges
      // it onto the SDK's narrow chat-completions parameter type.
      const params = { model: sentModel, ...body };
      return sdk.chat.completions.create(
        params as Parameters<typeof sdk.chat.completions.create>[0],
      );
    });
  log.info(
    `Agnes client: model=${model}, min_interval=${minIntervalMs}ms, max_retries=${retry.maxRetries}`,
  );

  /**
   * Serialized fixed-interval gate: requests start ≥ minIntervalMs apart,
   * strictly in submission order. Chained off a never-rejecting promise so
   * one failure cannot wedge the queue.
   */
  let queueTail: Promise<void> = Promise.resolve();
  let lastStart = Number.NEGATIVE_INFINITY;
  const acquireSlot = (): Promise<void> => {
    const gated = queueTail.then(async () => {
      const waitMs = lastStart + minIntervalMs - now();
      if (waitMs > 0) {
        log.debug(`        rate-limit gate: waiting ${waitMs}ms`);
        await sleep(waitMs);
      }
      lastStart = now();
    });
    queueTail = gated.catch(() => {});
    return gated;
  };

  async function complete(request: ChatCompletionRequest): Promise<unknown> {
    const body: Record<string, unknown> = {
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
      temperature: request.temperature ?? 0,
      max_tokens: request.maxTokens ?? 4_096,
    };
    if (request.tools !== undefined) {
      body.tools = request.tools;
      if (request.forceToolName !== undefined) {
        body.tool_choice = { type: "function", function: { name: request.forceToolName } };
      }
    }
    log.debug(
      `        agnes request: model=${model}, ~${request.user.length} chars user, tool=${request.forceToolName ?? "(none)"}`,
    );

    let attempt = 0;
    for (;;) {
      await acquireSlot();
      const t0 = now();
      try {
        const response = await transport({ model, body });
        log.debug(`        agnes response: ${now() - t0}ms`);
        return response;
      } catch (cause) {
        const status = statusOf(cause);
        const elapsed = now() - t0;
        if (attempt >= retry.maxRetries || !isRetriableCause(cause)) {
          log.debug(
            `        agnes error: status=${status ?? "?"}, ${elapsed}ms, ${attempt >= retry.maxRetries ? "max retries reached" : "non-retriable"}`,
          );
          throw cause;
        }
        attempt++;
        const capped = Math.min(retry.retryBaseDelayMs * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
        log.info(
          `        agnes retry ${attempt}/${retry.maxRetries}: status=${status ?? "?"} after ${elapsed}ms, backing off ${capped}ms`,
        );
        await retry.sleep(capped);
      }
    }
  }

  return { model, complete };
}

/** Statuses carrying meaning (OpenAI APIError et al. expose numeric status). */
function isRetriableCause(cause: unknown): boolean {
  const status = statusOf(cause);
  return status !== undefined && RETRIABLE_STATUSES.has(status);
}

function statusOf(cause: unknown): number | undefined {
  if (typeof cause !== "object" || cause === null || !("status" in cause)) return undefined;
  const status = (cause as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/** Rough char-based token estimate (≈4 chars/token for English prose). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Guard rail for the 512K context window: fails loudly with a sized estimate
 * rather than shipping an oversized payload to a far-away 400. Leaves the
 * documented output ceiling reserved for the completion itself.
 */
export function assertWithinContextWindow(label: string, texts: readonly string[]): void {
  const budget = AGNES_CONTEXT_WINDOW_TOKENS - AGNES_OUTPUT_RESERVE_TOKENS;
  const estimated = texts.reduce((sum, text) => sum + estimateTokens(text), 0);
  if (estimated > budget) {
    throw new Error(
      `${label}: payload estimates ~${estimated} tokens, over the ${budget}-token input budget ` +
        `(context window ${AGNES_CONTEXT_WINDOW_TOKENS}, reserve ${AGNES_OUTPUT_RESERVE_TOKENS})`,
    );
  }
}

export interface AgnesClient {
  readonly model: string;
  complete(request: ChatCompletionRequest): Promise<unknown>;
}

interface RetryOptions {
  readonly maxRetries: number;
  readonly retryBaseDelayMs: number;
  readonly sleep: (ms: number) => Promise<void>;
}
