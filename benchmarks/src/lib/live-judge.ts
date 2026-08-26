import OpenAI from "openai";
import type { EquivalenceRequest, Judge, SourceSupportRequest } from "./judge.js";

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
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly model?: string;
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

/**
 * Validates the forced tool-call arguments at the trust boundary: JSON
 * object with a `verdict` equal to one of the two allowed labels.
 */
export function parseVerdictArguments(
  rawArguments: string,
  positiveLabel: string,
  negativeLabel: string,
): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    throw new Error(`judge returned arguments that are not valid JSON: ${rawArguments.slice(0, 120)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("judge verdict arguments must be a JSON object");
  }
  const verdict = (parsed as Record<string, unknown>).verdict;
  if (typeof verdict !== "string") {
    throw new Error('judge verdict object must carry a string "verdict" field');
  }
  if (verdict === positiveLabel) return true;
  if (verdict === negativeLabel) return false;
  throw new Error(`judge verdict "${verdict}" is neither "${positiveLabel}" nor "${negativeLabel}"`);
}

/** Extracts the forced single tool call's argument string from a completion-shaped response. */
function firstForcedVerdictArguments(response: unknown): string {
  if (typeof response !== "object" || response === null || !("choices" in response)) {
    throw new Error("judge response has no choices");
  }
  const choices = (response as { choices: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("judge response carried no choices");
  }
  const message = choices[0] as { message?: unknown } | undefined;
  const toolCalls =
    typeof message === "object" && message !== null && "message" in message
      ? (message.message as { tool_calls?: unknown } | undefined)?.tool_calls
      : undefined;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    throw new Error("judge did not answer with the forced verdict tool call");
  }
  const first = toolCalls[0] as { function?: { arguments?: unknown } } | undefined;
  const args = first?.function?.arguments;
  if (typeof args !== "string" || args.length === 0) {
    throw new Error("judge verdict tool call carries no arguments");
  }
  return args;
}

export function createLiveJudge(options: LiveJudgeOptions): Judge {
  if (options.apiKey.trim().length === 0) {
    throw new Error("live judge requires an Agnes AI API key");
  }
  const model = options.model ?? JUDGE_MODEL;
  const client = new OpenAI({
    apiKey: options.apiKey,
    ...(options.baseUrl !== undefined ? { baseURL: options.baseUrl } : {}),
  });

  async function verdict(
    system: string,
    user: string,
    tool: VerdictToolDefinition,
    positiveLabel: string,
    negativeLabel: string,
  ): Promise<boolean> {
    const completion: unknown = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [tool],
      tool_choice: { type: "function", function: { name: tool.function.name } },
      temperature: 0,
    });
    return parseVerdictArguments(
      firstForcedVerdictArguments(completion),
      positiveLabel,
      negativeLabel,
    );
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
