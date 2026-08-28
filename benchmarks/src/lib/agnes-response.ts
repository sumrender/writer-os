/**
 * Shared parser for the responses of forced-tool-call completions
 * (ADR-0004: agnes-2.5-flash has no JSON-schema response mode, so all
 * structured output arrives as the arguments string of one forced tool
 * call). Extraction, checking, judging, and the sweep share these parsers;
 * malformed transport shapes fail precisely, never silently.
 */

/** Extracts the arguments string of the first (forced) tool call. */
export function firstForcedToolArguments(response: unknown): string {
  if (typeof response !== "object" || response === null || !("choices" in response)) {
    throw new Error("completion response has no choices");
  }
  const choices = (response as { choices: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("completion response carried no choices");
  }
  const message = choices[0] as { message?: unknown } | undefined;
  const toolCalls =
    typeof message === "object" && message !== null && "message" in message
      ? (message.message as { tool_calls?: unknown } | undefined)?.tool_calls
      : undefined;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    throw new Error("model did not answer with the forced tool call");
  }
  const first = toolCalls[0] as { function?: { arguments?: unknown } } | undefined;
  const args = first?.function?.arguments;
  if (typeof args !== "string" || args.length === 0) {
    throw new Error("forced tool call carries no arguments");
  }
  return args;
}

/**
 * Parses a verdict arguments string against a closed label pair: positive →
 * true, negative → false, anything else → precise failure.
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
    throw new Error(
      `model returned arguments that are not valid JSON: ${rawArguments.slice(0, 120)}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("verdict arguments must be a JSON object");
  }
  const verdict = (parsed as Record<string, unknown>).verdict;
  if (typeof verdict !== "string") {
    throw new Error('verdict object must carry a string "verdict" field');
  }
  if (verdict === positiveLabel) return true;
  if (verdict === negativeLabel) return false;
  throw new Error(
    `verdict "${verdict}" is neither "${positiveLabel}" nor "${negativeLabel}"`,
  );
}

/** Reads the assistant message's text content (plain-prose completions). */
export function firstMessageContent(response: unknown): string {
  if (typeof response !== "object" || response === null || !("choices" in response)) {
    throw new Error("completion response has no choices");
  }
  const choices = (response as { choices: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("completion response carried no choices");
  }
  const message = choices[0] as { message?: unknown } | undefined;
  const content =
    typeof message === "object" && message !== null
      ? (message.message as { content?: unknown } | undefined)?.content
      : undefined;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("completion response carries no text content");
  }
  return content;
}
