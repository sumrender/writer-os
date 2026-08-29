import { ENTITY_KINDS, type EntityKind } from "./story-facts.js";
import { storyFacts } from "./fact-text.js";
import { isPlainObject, nonEmptyString } from "./schema-primitives.js";
import { firstForcedToolArguments } from "./agnes-response.js";
import { assertWithinContextWindow, type AgnesClient } from "./agnes-client.js";
import type { Check, CheckFlag } from "./pipeline.js";

/**
 * Vendor-backed consistency checker behind the pipeline `Check` port
 * (docs/TESTING.md axis 2). Receives the canon state rendered as facts plus
 * a candidate chapter and flags only factual contradictions — exactly what
 * the checker axis measures (perturbations caught, controls clean).
 */

const CHECK_SYSTEM = [
  "You are a consistency checker for a benchmark.",
  "You receive canon facts plus candidate chapter text; flag ONLY statements in the text",
  "that contradict a listed canon fact (a changed item holder, thread status, relationship",
  "type, dead-wrong character status or appearance, broken timeline order, misspelled locked",
  "lexicon term). Never flag stylistic variation, elaboration that does not contradict canon,",
  "or new non-contradictory facts. Each flag's message cites the canon value versus the claim.",
  "Emit an empty flags array when nothing contradicts canon.",
].join(" ");

const CHECK_TOOL = {
  type: "function",
  function: {
    name: "record_flags",
    description: "Record factual contradictions between the chapter text and canon.",
    parameters: {
      type: "object",
      properties: {
        flags: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: [...ENTITY_KINDS] },
              message: { type: "string" },
            },
            required: ["kind", "message"],
            additionalProperties: false,
          },
        },
      },
      required: ["flags"],
      additionalProperties: false,
    },
  },
} as const;

function checkFail(index: number, problem: string): never {
  throw new Error(`checker flag #${index}: ${problem}`);
}

function flagSnippet(raw: Record<string, unknown>): string {
  return JSON.stringify(raw).slice(0, 160);
}

function isEntityKind(value: unknown): value is EntityKind {
  return typeof value === "string" && (ENTITY_KINDS as readonly string[]).includes(value);
}

/** Validates one model-returned flag precisely, preserving exact typing. */
function validateFlag(raw: Record<string, unknown>, index: number): CheckFlag {
  const kind = raw["kind"];
  if (!isEntityKind(kind)) {
    checkFail(index, `"kind" must be one of ${ENTITY_KINDS.join(", ")}`);
  }
  for (const key of Object.keys(raw)) {
    if (key !== "kind" && key !== "message") checkFail(index, `unexpected field "${key}"`);
  }
  const message = raw["message"];
  if (!nonEmptyString(message)) checkFail(index, '"message" must be a non-empty string');
  return { kind, message };
}

export function parseCheckerFlags(toolArguments: string): readonly CheckFlag[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolArguments);
  } catch {
    throw new Error(
      `checker returned arguments that are not valid JSON: ${toolArguments.slice(0, 120)}`,
    );
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed["flags"])) {
    throw new Error('checker arguments must carry a "flags" array');
  }
  return parsed["flags"].map((raw, index): CheckFlag => {
    if (!isPlainObject(raw)) checkFail(index, "must be an object");
    try {
      return validateFlag(raw, index);
    } catch (error) {
      // Every trust-boundary rejection carries the raw flag (truncated) so
      // malformed vendor output is diagnosable from the run log alone.
      if (error instanceof Error && !error.message.includes("near: ")) {
        throw new Error(`${error.message} near: ${flagSnippet(raw)}`);
      }
      throw error;
    }
  });
}

export function checkerUserPrompt(input: {
  readonly canonView: string;
  readonly chapterText: string;
}): string {
  return [
    "Canon established so far:",
    input.canonView,
    "",
    "Chapter text:",
    input.chapterText,
    "",
    "Flag only statements in the chapter text that contradict these canon facts.",
  ].join("\n");
}

export function createAgnesCheck(client: AgnesClient): Check {
  return async (factsAsOf, chapterText) => {
    const canonView =
      storyFacts(factsAsOf)
        .map((fact) => fact.text)
        .join("\n") || "(no canon established yet)";
    assertWithinContextWindow("consistency check", [CHECK_SYSTEM, canonView, chapterText]);
    const user = checkerUserPrompt({ canonView, chapterText });
    const complete = (prompt: string): Promise<unknown> =>
      client.complete({
        system: CHECK_SYSTEM,
        user: prompt,
        tools: [CHECK_TOOL],
        forceToolName: CHECK_TOOL.function.name,
        temperature: 0,
        maxTokens: 4_096,
      });
    let flags: readonly CheckFlag[];
    try {
      flags = parseCheckerFlags(firstForcedToolArguments(await complete(user)));
    } catch (error) {
      // One self-healing retry per check: validation failures are fed back
      // verbatim so a single malformed forced-tool response cannot kill a
      // whole run. A second failure propagates with both problems attached.
      const problem = error instanceof Error ? error.message : String(error);
      const retryUser = [
        user,
        "",
        `Your previous record_flags call was rejected by validation: ${problem}`,
        `Re-emit complete corrected arguments: every flag carries \"kind\" set to one of`,
        `${ENTITY_KINDS.join(", ")}, plus a non-empty \"message\".`,
      ].join("\n");
      try {
        flags = parseCheckerFlags(firstForcedToolArguments(await complete(retryUser)));
      } catch (retryError) {
        const retryProblem = retryError instanceof Error ? retryError.message : String(retryError);
        throw new Error(`checker retry after "${problem}" also failed: ${retryProblem}`);
      }
    }
    return { flags: [...flags] };
  };
}
