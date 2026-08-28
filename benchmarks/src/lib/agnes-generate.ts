import { assertWithinContextWindow, type AgnesClient } from "./agnes-client.js";
import { firstMessageContent } from "./agnes-response.js";
import type { Generate } from "./pipeline.js";

/**
 * Vendor-backed chapter generator behind the pipeline `Generate` port
 * (docs/TESTING.md axis 3). Conditions on the assembled context through
 * ordinal N (rendered by lib/assembled-context.ts — the same rendering the
 * checker-mediated grade assumes), offers declared beats as intent, and
 * returns plain prose. Fidelity is graded by beat assertions and the checker,
 * so temperature stays creative but bounded.
 */

export const GENERATION_TEMPERATURE = 0.6;
export const GENERATION_MAX_TOKENS = 4_096;

const GENERATE_SYSTEM = [
  "You are a novelist continuing a serialized book.",
  "Write only the next chapter's prose — no title headings, no meta commentary.",
  "Stay consistent with every canon fact provided in the context, and weave each",
  "required beat into the narrative naturally.",
].join(" ");

export function generationUserPrompt(input: {
  readonly throughOrdinal: number;
  readonly assembledContext: string;
  readonly beats?: readonly string[];
}): string {
  return [
    `Write chapter ${input.throughOrdinal + 1}, continuing directly after chapter ${input.throughOrdinal}.`,
    "",
    "Assembled context through the previous chapter:",
    input.assembledContext,
    "",
    input.beats === undefined || input.beats.length === 0
      ? "No specific beats were requested for this chapter."
      : [`Required beats this chapter must include:`, ...input.beats.map((beat) => `- ${beat}`)].join("\n"),
  ].join("\n");
}

export function createAgnesGenerate(client: AgnesClient): Generate {
  return async (context, intent) => {
    const user = generationUserPrompt({
      throughOrdinal: context.throughOrdinal,
      assembledContext: context.assembledContext,
      beats: intent?.beats,
    });
    assertWithinContextWindow(`generation of chapter ${context.throughOrdinal + 1}`, [
      GENERATE_SYSTEM,
      user,
    ]);
    const response: unknown = await client.complete({
      system: GENERATE_SYSTEM,
      user,
      temperature: GENERATION_TEMPERATURE,
      maxTokens: GENERATION_MAX_TOKENS,
    });
    return {
      ordinal: context.throughOrdinal + 1,
      text: firstMessageContent(response),
    };
  };
}
