import type { EquivalenceRequest, Judge, SourceSupportRequest } from "./judge.js";
import { createAgnesClient, type AgnesClient } from "./agnes-client.js";
import {
  firstForcedToolArguments,
  parseVerdictArguments,
} from "./agnes-response.js";
import { silentLogger, type Logger } from "./logger.js";

/**
 * Vendor-backed Judge (ADR-0004: Agnes AI's OpenAI-compatible endpoint,
 * `agnes-2.5-flash`). Verdicts come back as forced tool calls — ADR-0004
 * notes the text model has no JSON-schema response mode, so all structured
 * output flows through a single-argument enum tool.
 *
 * The equivalence half implements the ADR-0005 hard contract: a fixed rubric
 * and exactly two values per call, never fixture text. The support half
 * (open-world sweep) intentionally sees source text; its verdicts are
 * estimates by design.
 */

export const JUDGE_MODEL = "agnes-2.5-flash";

export interface LiveJudgeOptions {
  readonly apiKey?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  /**
   * Pre-built client to share the rate-limited Agnes queue with other live
   * operations (extraction/checking/generation). When omitted, one client
   * is constructed from apiKey/baseUrl.
   */
  readonly client?: AgnesClient;
  /** Optional progress sink. */
  readonly log?: Logger;
}


interface VerdictToolDefinition {
  readonly type: "function";
  readonly function: {
    readonly name: "record_verdict";
    readonly description: string;
    readonly parameters: {
      readonly type: "object";
      readonly properties: { readonly verdict: { readonly type: "string"; readonly enum: readonly string[] } };
      readonly required: readonly ["verdict"];
      readonly additionalProperties: false;
    };
  };
}

export const EQUIVALENCE_TOOL: VerdictToolDefinition = {
  type: "function",
  function: {
    name: "record_verdict",
    description: "Record whether the two values are equivalent.",
    parameters: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["equivalent", "not_equivalent"] },
      },
      required: ["verdict"],
      additionalProperties: false,
    },
  },
};

export const SUPPORT_TOOL: VerdictToolDefinition = {
  type: "function",
  function: {
    name: "record_verdict",
    description: "Record whether the fact is supported by the source text.",
    parameters: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["supported", "unsupported"] },
      },
      required: ["verdict"],
      additionalProperties: false,
    },
  },
};

const EQUIVALENCE_SYSTEM = [
  "You are an equivalence judge for a benchmark grader.",
  "You will receive exactly two values; decide only whether they are equivalent in meaning,",
  "ignoring wording, phrasing, punctuation, and word order. Treat different facts as not equivalent:",
  "a changed relationship type, holder, status, or event is never equivalent.",
  "You see nothing else: no story text, no context. Answer only equivalent or not_equivalent.",
].join(" ");

const SUPPORT_SYSTEM = [
  "You are a support judge for a benchmark's open-world sweep.",
  "You receive one extracted fact and source text; answer supported only if the source explicitly",
  "establishes that exact fact. If the source contradicts it, or merely implies or leaves it out,",
  "answer unsupported. Be strict: absence of evidence means unsupported.",
].join(" ");

export function equivalenceSystemPrompt(): string {
  return EQUIVALENCE_SYSTEM;
}

export function equivalenceUserPrompt(request: EquivalenceRequest): string {
  return `Value A: ${request.left}\nValue B: ${request.right}\nAre these two values equivalent?`;
}

export function supportSystemPrompt(): string {
  return SUPPORT_SYSTEM;
}

export function supportUserPrompt(request: SourceSupportRequest): string {
  return `Extracted fact:\n${request.fact}\n\nSource text:\n${request.sourceText}\n\nIs the fact supported by the source text?`;
}

/** Arguments parsing sits on the shared response seam; kept exported for compat. */
export { parseVerdictArguments } from "./agnes-response.js";

export function createLiveJudge(options: LiveJudgeOptions): Judge {
  if (options.client === undefined && (options.apiKey ?? "").trim().length === 0) {
    throw new Error("live judge requires an Agnes AI API key");
  }
  const model = options.model ?? JUDGE_MODEL;
  const log = options.log ?? silentLogger;
  const client =
    options.client ??
    createAgnesClient({
      apiKey: options.apiKey ?? "",
      ...(options.baseUrl !== undefined && options.baseUrl.trim().length > 0
        ? { baseUrl: options.baseUrl }
        : {}),
      model,
      log,
    });

  async function verdict(
    system: string,
    user: string,
    tool: VerdictToolDefinition,
    positiveLabel: string,
    negativeLabel: string,
  ): Promise<boolean> {
    const attempt = async (prompt: string): Promise<boolean> => {
      log.debug(`      judge: posting verdict request (tool=${tool.function.name})`);
      const t0 = Date.now();
      const completion: unknown = await client.complete({
        system,
        user: prompt,
        tools: [tool],
        forceToolName: tool.function.name,
        temperature: 0,
        // Reasoning tokens precede tool arguments on this model (observed via
        // reasoning_content); a generous cap keeps tiny verdicts from truncating.
        maxTokens: 1_024,
      });
      log.debug(`      judge: response received in ${Date.now() - t0}ms`);
      return parseVerdictArguments(
        firstForcedToolArguments(completion),
        positiveLabel,
        negativeLabel,
      );
    };
    try {
      return await attempt(user);
    } catch (error) {
      // One self-healing retry, mirroring agnes-extract/agnes-check: a single
      // malformed forced-tool response (model answers in prose, off-rubric
      // verdict) must not kill a whole run. A second failure propagates with
      // both problems attached.
      const problem = error instanceof Error ? error.message : String(error);
      log.info(`      judge: verdict invalid, retrying: ${problem}`);
      const retryUser = [
        user,
        "",
        `Your previous ${tool.function.name} call was rejected by validation: ${problem}`,
        `Re-emit one corrected call with a "verdict" of ${positiveLabel} or ${negativeLabel}.`,
      ].join("\n");
      try {
        return await attempt(retryUser);
      } catch (retryError) {
        const retryProblem = retryError instanceof Error ? retryError.message : String(retryError);
        throw new Error(`judge verdict retry after "${problem}" also failed: ${retryProblem}`);
      }
    }
  }

  return {
    async areEquivalent(request) {
      return verdict(
        equivalenceSystemPrompt(),
        equivalenceUserPrompt(request),
        EQUIVALENCE_TOOL,
        "equivalent",
        "not_equivalent",
      );
    },
    async isSupportedBySource(request) {
      return verdict(
        supportSystemPrompt(),
        supportUserPrompt(request),
        SUPPORT_TOOL,
        "supported",
        "unsupported",
      );
    },
  };
}

