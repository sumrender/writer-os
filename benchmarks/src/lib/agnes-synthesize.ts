import { firstForcedToolArguments } from "./agnes-response.js";
import {
  assertWithinContextWindow,
  type AgnesClient,
  type ChatCompletionRequest,
} from "./agnes-client.js";
import { isPlainObject } from "./schema-primitives.js";
import type { ResponseCache } from "./response-cache.js";
import { hashVerdictInput } from "./verdict-cache.js";
import { silentLogger, type Logger } from "./logger.js";
import { storyFacts } from "./fact-text.js";
import type { StoryFacts } from "./story-facts.js";
import {
  BIBLE_SECTIONS,
  MODEL_SECTION_KEYS,
  bibleMasterPrompt,
  validateBible,
  type BibleSectionSpec,
} from "./bible-sections.js";
import type { ModelSectionKey, ModelSections, StoryBible } from "./story-bible.js";
import { storyBibleFromSections } from "./story-bible.js";
import { deriveGraphData } from "./bible-graph.js";
import type {
  SynthesisStrategy,
  SynthesizeBible,
  SynthesizeChapterSummary,
} from "./pipeline.js";

/**
 * Vendor-backed synthesis behind the pipeline `SynthesizeChapterSummary` and
 * `SynthesizeBible` ports (issue #14). Both are forced-tool structured
 * outputs parsed at the trust boundary: chapter summaries record one string
 * per ordinal; the bible is synthesized either per-section (one
 * `emit_section` call per model section, the default, for focused-prompt
 * quality) or monolithic (one `assemble_bible` call composing the same
 * section blocks). One self-healing retry mirrors extraction; a still-failing
 * payload is a hard error — nothing silently reaches the bible.
 */

export const SYNTHESIZE_MAX_TOKENS = 16_384;

const SUMMARY_SYSTEM = [
  "You are a chapter summarizer feeding a Story Bible pipeline.",
  "Summarize the events THIS chapter establishes in one or two sentences,",
  "grounded strictly in the chapter text and the canon established before it.",
  "Never mention events the chapter does not contain.",
].join(" ");

const SUMMARY_TOOL_NAME = "record_summary";
const SUMMARY_TOOL = {
  type: "function",
  function: {
    name: SUMMARY_TOOL_NAME,
    description: "Record the summary of this chapter.",
    parameters: {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
      additionalProperties: false,
    },
  },
} as const;

const SECTION_TOOL_NAME = "emit_section";
const BIBLE_TOOL_NAME = "assemble_bible";

const SUMMARY_RETRY_INSTRUCTIONS = [
  'Re-emit complete corrected arguments: one JSON object whose "summary" field is a string.',
];

const BIBLE_RETRY_INSTRUCTIONS = [
  "Re-emit complete corrected arguments matching the documented shape exactly.",
  "An empty array (or empty overview) is valid whenever the canon establishes nothing.",
];

const BIBLE_SYSTEM = [
  "You are the Story Bible synthesizer distilling graded Story Facts and chapter summaries into an author-facing bible (ADR-0007: two-layer canon).",
  "Use only what the inputs establish; preserve source spellings exactly.",
  "An empty array (or empty overview) is valid whenever the canon establishes nothing for a section — never invent content.",
].join(" ");

/** Per-section forced tool: the section's value under its wire schema. */
function sectionTool(spec: BibleSectionSpec<ModelSectionKey>): unknown {
  return {
    type: "function",
    function: {
      name: SECTION_TOOL_NAME,
      description: `Emit the "${spec.key}" section of the Story Bible.`,
      parameters: {
        type: "object",
        properties: { value: spec.wireSchema },
        required: ["value"],
        additionalProperties: false,
      },
    },
  };
}

/** Monolithic forced tool: flat wireKey properties typed by each wire schema. */
const BIBLE_TOOL: unknown = {
  type: "function",
  function: {
    name: BIBLE_TOOL_NAME,
    description: "Assemble the complete Story Bible in one call.",
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        MODEL_SECTION_KEYS.map((key) => [BIBLE_SECTIONS[key].wireKey, BIBLE_SECTIONS[key].wireSchema]),
      ),
      required: MODEL_SECTION_KEYS.map((key) => BIBLE_SECTIONS[key].wireKey),
      additionalProperties: false,
    },
  },
};

export function summaryUserPrompt(input: {
  readonly ordinal: number;
  readonly canonView: string;
  readonly chapterText: string;
}): string {
  return [
    `Chapter ordinal: ${input.ordinal}`,
    "",
    "Canon established before this chapter:",
    input.canonView,
    "",
    "Chapter text:",
    input.chapterText,
    "",
    "Summarize the events this chapter adds to the story.",
  ].join("\n");
}

export function bibleSynthesisUserPrompt(input: {
  readonly factsText: string;
  readonly summariesText: string;
  readonly bookText: string;
  /** The master prompt (monolithic) or the one section's instruction block. */
  readonly sectionsBlock: string;
}): string {
  return [
    "Story Facts (graded canon):",
    input.factsText,
    "",
    "Chapter summaries:",
    input.summariesText,
    "",
    "Book text:",
    input.bookText,
    "",
    "Sections to produce:",
    input.sectionsBlock,
  ].join("\n");
}

function factsView(facts: StoryFacts): string {
  return (
    storyFacts(facts)
      .map((fact) => fact.text)
      .join("\n") || "(no canon established yet)"
  );
}

function summariesView(summaries: readonly { readonly ordinal: number; readonly summary: string }[]): string {
  if (summaries.length === 0) return "(no chapter summaries yet)";
  return summaries.map((s) => `Chapter ${s.ordinal}: ${s.summary}`).join("\n");
}

function bookView(chapters: readonly string[]): string {
  return chapters
    .map((text, index) => `[Chapter ${index + 1}]\n${text}`)
    .join("\n\n");
}

/**
 * Request identity for cache keys: every field that determines the request,
 * plus the synthesis strategy so per-section and monolithic paths never
 * share keys (issue #14).
 */
function synthesisRequestKey(
  operation: string,
  model: string,
  request: ChatCompletionRequest,
  strategy: SynthesisStrategy,
): string {
  return hashVerdictInput(operation, {
    model,
    system: request.system,
    user: request.user,
    tools: request.tools ?? null,
    forceToolName: request.forceToolName ?? null,
    temperature: request.temperature ?? null,
    maxTokens: request.maxTokens ?? null,
    strategy,
  });
}

export interface AgnesSynthesizeOptions {
  /**
   * Content-hash cache of raw synthesis responses (same discipline as the
   * extraction cache: hits re-enter the trust boundary — stored payloads go
   * through the same parse/validate path as fresh ones — so caching changes
   * cost, never what is measured).
   */
  readonly responseCache?: ResponseCache;
  /** Optional progress sink. */
  readonly log?: Logger;
}

/** Parses one forced-tool arguments string into its JSON object payload. */
function parseToolObject(toolArguments: string, what: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolArguments);
  } catch {
    throw new Error(`${what} tool arguments are not valid JSON: ${toolArguments.slice(0, 120)}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`${what} tool arguments must be a JSON object near: ${toolArguments.slice(0, 160)}`);
  }
  return parsed;
}

/**
 * Cache-aware completion shared by both synthesis ops: cache hits re-enter
 * the trust boundary (stored payloads go through the same parse/validate
 * path as fresh ones), misses call Agnes and persist the raw response.
 */
function cachedComplete(input: {
  readonly client: AgnesClient;
  readonly responseCache?: ResponseCache;
  readonly log: Logger;
  readonly operation: string;
  readonly strategy: SynthesisStrategy;
  readonly label: string;
}): (request: ChatCompletionRequest) => Promise<unknown> {
  const { client, responseCache, log, operation, strategy, label } = input;
  if (responseCache === undefined) return (request) => client.complete(request);
  return async (request) => {
    const key = synthesisRequestKey(operation, client.model, request, strategy);
    const cached = responseCache.get(key);
    if (isPlainObject(cached)) {
      log.debug(`        ${label} cache HIT (key ${key.slice(0, 12)}…); re-validating at trust boundary`);
      return cached;
    }
    log.debug(`        ${label} cache MISS (key ${key.slice(0, 12)}…); calling agnes`);
    const response = await client.complete(request);
    responseCache.set(key, response);
    return response;
  };
}

/**
 * One self-healing retry shared by both synthesis ops: the first failure is
 * logged with its validation problem, the retry re-sends the user prompt
 * plus correction instructions, and a second failure is a hard error —
 * nothing silently reaches the bible.
 */
async function withRetry<T>(
  log: Logger,
  label: string,
  user: string,
  retryInstructions: readonly string[],
  attempt: (prompt: string) => Promise<T>,
): Promise<T> {
  let problem = "";
  try {
    return await attempt(user);
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
    log.info(`        ${label} invalid, retrying: ${problem}`);
  }
  const retryUser = [
    user,
    "",
    `Your previous call was rejected by validation: ${problem}`,
    ...retryInstructions,
  ].join("\n");
  try {
    return await attempt(retryUser);
  } catch (retryError) {
    const retryProblem = retryError instanceof Error ? retryError.message : String(retryError);
    throw new Error(`${label} retry after "${problem}" also failed: ${retryProblem}`);
  }
}

/**
 * Vendor-backed chapter summaries. The model sees the chapter plus the canon
 * established BEFORE it (mirroring extraction's no-answer-leakage discipline)
 * and returns one summary string; validation rejects anything but a string
 * `summary` field, with one self-healing retry attached to the failure.
 */
export function createAgnesChapterSummary(
  client: AgnesClient,
  options: AgnesSynthesizeOptions & { readonly strategy?: SynthesisStrategy } = {},
): SynthesizeChapterSummary {
  const log = options.log ?? silentLogger;
  const strategy = options.strategy ?? "per-section";
  const complete = cachedComplete({
    client,
    ...(options.responseCache !== undefined ? { responseCache: options.responseCache } : {}),
    log,
    operation: "synthesize-chapter-summary",
    strategy,
    label: "summary",
  });

  return async ({ ordinal, text, factsSoFar }) => {
    const canonView = factsView(factsSoFar);
    assertWithinContextWindow(`summary of chapter ${ordinal}`, [SUMMARY_SYSTEM, canonView, text]);
    const user = summaryUserPrompt({ ordinal, canonView, chapterText: text });
    const attempt = async (prompt: string): Promise<string> => {
      const payload = parseToolObject(
        firstForcedToolArguments(await complete({
          system: SUMMARY_SYSTEM,
          user: prompt,
          tools: [SUMMARY_TOOL],
          forceToolName: SUMMARY_TOOL_NAME,
          temperature: 0,
          maxTokens: SYNTHESIZE_MAX_TOKENS,
        })),
        "summary",
      );
      const summary = payload["summary"];
      if (typeof summary !== "string") {
        throw new Error('summary payload must carry a string "summary" field');
      }
      return summary;
    };
    const summary = await withRetry(log, "chapter summary", user, SUMMARY_RETRY_INSTRUCTIONS, attempt);
    log.debug(`        summary of chapter ${ordinal}: ${summary.length} chars`);
    return { ordinal, summary };
  };
}

export interface AgnesBibleSynthesizeOptions extends AgnesSynthesizeOptions {
  /** "per-section" (default) or "monolithic" — rides in every cache key. */
  readonly strategy?: SynthesisStrategy;
}

/**
 * Vendor-backed bible synthesis. Per-section makes 12 focused forced-tool
 * calls (one per registered model section); monolithic makes one call whose
 * arguments are the flat wireKey payload handed to the master validator.
 * Both paths merge the validated sections with the carried chapter summaries
 * and the deterministically derived graph.
 */
export function createAgnesBibleSynthesizer(
  client: AgnesClient,
  options: AgnesBibleSynthesizeOptions = {},
): SynthesizeBible {
  const log = options.log ?? silentLogger;
  const strategy = options.strategy ?? "per-section";
  const complete = cachedComplete({
    client,
    ...(options.responseCache !== undefined ? { responseCache: options.responseCache } : {}),
    log,
    operation: "synthesize-bible",
    strategy,
    label: "bible",
  });

  const attemptSection = async <K extends ModelSectionKey>(
    spec: BibleSectionSpec<K>,
    user: string,
    canon: StoryFacts,
  ): Promise<ModelSections[K]> =>
    withRetry(log, `bible section ${spec.key}`, user, BIBLE_RETRY_INSTRUCTIONS, async (prompt) => {
      const payload = parseToolObject(
        firstForcedToolArguments(
          await complete({
            system: BIBLE_SYSTEM,
            user: prompt,
            tools: [sectionTool(spec)],
            forceToolName: SECTION_TOOL_NAME,
            temperature: 0,
            maxTokens: SYNTHESIZE_MAX_TOKENS,
          }),
        ),
        "section",
      );
      return spec.validate(payload["value"], canon);
    });

  const attemptMonolithic = async (user: string, canon: StoryFacts): Promise<ModelSections> =>
    withRetry(log, "bible assembly", user, BIBLE_RETRY_INSTRUCTIONS, async (prompt) =>
      validateBible(
        parseToolObject(
          firstForcedToolArguments(
            await complete({
              system: BIBLE_SYSTEM,
              user: prompt,
              tools: [BIBLE_TOOL],
              forceToolName: BIBLE_TOOL_NAME,
              temperature: 0,
              maxTokens: SYNTHESIZE_MAX_TOKENS,
            }),
          ),
          "bible",
        ),
        canon,
      ),
    );

  return async (input) => {
    const factsText = factsView(input.facts);
    const summariesText = summariesView(input.summaries);
    const bookText = bookView(input.chapters);
    assertWithinContextWindow("bible synthesis", [BIBLE_SYSTEM, factsText, summariesText, bookText]);

    const shared = { factsText, summariesText, bookText };
    let sections: ModelSections;
    if (strategy === "monolithic") {
      sections = await attemptMonolithic(
        bibleSynthesisUserPrompt({ ...shared, sectionsBlock: bibleMasterPrompt() }),
        input.facts,
      );
    } else {
      const sectionPrompt = (key: ModelSectionKey): string =>
        bibleSynthesisUserPrompt({
          ...shared,
          sectionsBlock: BIBLE_SECTIONS[key].instruction,
        });
      sections = {
        bookOverview: await attemptSection(
          BIBLE_SECTIONS.bookOverview,
          sectionPrompt("bookOverview"),
          input.facts,
        ),
        world: await attemptSection(BIBLE_SECTIONS.world, sectionPrompt("world"), input.facts),
        characterProfiles: await attemptSection(
          BIBLE_SECTIONS.characterProfiles,
          sectionPrompt("characterProfiles"),
          input.facts,
        ),
        locationProfiles: await attemptSection(
          BIBLE_SECTIONS.locationProfiles,
          sectionPrompt("locationProfiles"),
          input.facts,
        ),
        threadRollups: await attemptSection(
          BIBLE_SECTIONS.threadRollups,
          sectionPrompt("threadRollups"),
          input.facts,
        ),
        groups: await attemptSection(BIBLE_SECTIONS.groups, sectionPrompt("groups"), input.facts),
        itemsOfSignificance: await attemptSection(
          BIBLE_SECTIONS.itemsOfSignificance,
          sectionPrompt("itemsOfSignificance"),
          input.facts,
        ),
        lexiconNotes: await attemptSection(
          BIBLE_SECTIONS.lexiconNotes,
          sectionPrompt("lexiconNotes"),
          input.facts,
        ),
        openLoops: await attemptSection(BIBLE_SECTIONS.openLoops, sectionPrompt("openLoops"), input.facts),
        styleRollup: await attemptSection(BIBLE_SECTIONS.styleRollup, sectionPrompt("styleRollup"), input.facts),
        worldTimeline: await attemptSection(
          BIBLE_SECTIONS.worldTimeline,
          sectionPrompt("worldTimeline"),
          input.facts,
        ),
        bookTimeline: await attemptSection(
          BIBLE_SECTIONS.bookTimeline,
          sectionPrompt("bookTimeline"),
          input.facts,
        ),
      };
    }

    return storyBibleFromSections(
      sections,
      input.summaries,
      deriveGraphData({ facts: input.facts, chapterTexts: input.chapters }),
    );
  };
}
