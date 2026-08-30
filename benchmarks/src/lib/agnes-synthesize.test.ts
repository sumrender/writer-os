import { describe, expect, it } from "vitest";
import { emptyStoryFacts, type StoryFacts } from "./story-facts.js";
import type { AgnesClient, ChatCompletionRequest } from "./agnes-client.js";
import { createAgnesBibleSynthesizer, createAgnesChapterSummary } from "./agnes-synthesize.js";
import { MemoryResponseCache } from "./response-cache.js";
import { MODEL_SECTION_KEYS, BIBLE_SECTIONS } from "./bible-sections.js";
import type { ModelSectionKey } from "./story-bible.js";

/** A client that answers every completion with the next scripted payload. */
function scriptedClient(responses: readonly unknown[]): {
  client: AgnesClient;
  requests: ChatCompletionRequest[];
} {
  const requests: ChatCompletionRequest[] = [];
  let next = 0;
  const client: AgnesClient = {
    model: "scripted",
    async complete(request) {
      requests.push(request);
      return responses[next++];
    },
  };
  return { client, requests };
}

function toolResponse(args: unknown): unknown {
  return {
    choices: [
      { message: { tool_calls: [{ function: { arguments: JSON.stringify(args) } }] } },
    ],
  };
}

function summaryResponse(summary: string): unknown {
  return toolResponse({ summary });
}

function sectionResponse(value: unknown): unknown {
  return toolResponse({ value });
}

function bibleResponse(payload: Record<string, unknown>): unknown {
  return toolResponse(payload);
}

const SUMMARY_INPUT = {
  ordinal: 2,
  text: "The chapter text.",
  factsSoFar: emptyStoryFacts(),
};

const SECTION_VALUES: { readonly [K in ModelSectionKey]: unknown } = {
  bookOverview: {
    title: "The Brass Compass",
    genre: "keeper's tale",
    era: "the age of the light",
    setting: "the light",
    premise: "A keeper's tale.",
    synopsis: 'plot thread "the ledger" stands open',
    themes: "light",
  },
  world: [{ topic: "the light", note: "burns without oil" }],
  characterProfiles: ["Bare Name"],
  locationProfiles: [{ name: "the light", profile: "A lighthouse." }],
  threadRollups: [{ thread: "the ledger", status: "open", rollup: "r" }],
  groups: [],
  itemsOfSignificance: [{ name: "brass compass", description: "Points wrong." }],
  lexiconNotes: [],
  openLoops: [{ description: "Who burned it?", openedAtOrdinal: 1 }],
  styleRollup: [{ field: "narration", value: "close third" }],
  worldTimeline: ["event one"],
  bookTimeline: ["event two"],
};

const SECTION_RESPONSES = MODEL_SECTION_KEYS.map((key) => sectionResponse(SECTION_VALUES[key]));

const BIBLE_INPUT = (): {
  chapters: readonly string[];
  facts: StoryFacts;
  summaries: readonly { readonly ordinal: number; readonly summary: string }[];
} => ({
  chapters: ["Chapter one text.", "Chapter two text."],
  facts: {
    ...emptyStoryFacts(),
    characters: [{ name: "Bare Name" }],
    locations: [{ name: "the light" }],
    threads: [{ thread: "the ledger", status: "open" }],
  },
  summaries: [
    { ordinal: 1, summary: "One." },
    { ordinal: 2, summary: "Two." },
  ],
});

describe("createAgnesChapterSummary", () => {
  it("parses the forced summary call and shows the model only prior canon", async () => {
    const { client, requests } = scriptedClient([summaryResponse("Mara keeps the light.")]);
    const summarize = createAgnesChapterSummary(client);

    const entry = await summarize({
      ordinal: 3,
      text: "The bell rang.",
      factsSoFar: {
        ...emptyStoryFacts(),
        characters: [{ name: "Mara Vey" }],
      },
    });

    expect(entry).toEqual({ ordinal: 3, summary: "Mara keeps the light." });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.forceToolName).toBe("record_summary");
    const prompt = String(requests[0]?.user);
    expect(prompt).toContain("Chapter ordinal: 3");
    expect(prompt).toContain('character named "Mara Vey"');
    expect(prompt).toContain("The bell rang.");
  });

  it("retries once with the validation error attached, then hard-fails", async () => {
    const { client, requests } = scriptedClient([
      toolResponse({ wrong: "shape" }),
      summaryResponse("Recovered."),
    ]);
    const summarize = createAgnesChapterSummary(client);
    await expect(summarize(SUMMARY_INPUT)).resolves.toEqual({
      ordinal: 2,
      summary: "Recovered.",
    });
    expect(requests).toHaveLength(2);
    expect(String(requests[1]?.user)).toContain("rejected by validation");

    const hopeless = scriptedClient([toolResponse({ wrong: 1 }), toolResponse({ also: "wrong" })]);
    await expect(createAgnesChapterSummary(hopeless.client)(SUMMARY_INPUT)).rejects.toThrow(
      /chapter summary retry after .* also failed/,
    );
    expect(hopeless.requests).toHaveLength(2);
  });

  it("serves identical repeat summaries from the cache without new client calls", async () => {
    let calls = 0;
    const client: AgnesClient = {
      model: "agnes-2.5-flash",
      async complete() {
        calls++;
        return summaryResponse("Same.");
      },
    };
    const cache = new MemoryResponseCache();
    const summarize = createAgnesChapterSummary(client, { responseCache: cache });

    const first = await summarize(SUMMARY_INPUT);
    const second = await summarize(SUMMARY_INPUT);

    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  it("keys the cache by strategy so switching strategies never serves stale paths", async () => {
    let calls = 0;
    const client: AgnesClient = {
      model: "agnes-2.5-flash",
      async complete() {
        calls++;
        return summaryResponse("Same.");
      },
    };
    const cache = new MemoryResponseCache();
    const perSection = createAgnesChapterSummary(client, {
      responseCache: cache,
      strategy: "per-section",
    });
    const monolithic = createAgnesChapterSummary(client, {
      responseCache: cache,
      strategy: "monolithic",
    });

    await perSection(SUMMARY_INPUT);
    await perSection(SUMMARY_INPUT);
    expect(calls).toBe(1);
    await monolithic(SUMMARY_INPUT);
    expect(calls).toBe(2);
  });
});

describe("createAgnesBibleSynthesizer — per-section", () => {
  it("makes one emit_section call per model section and fuses the full bible", async () => {
    const { client, requests } = scriptedClient(SECTION_RESPONSES);
    const synthesize = createAgnesBibleSynthesizer(client, { strategy: "per-section" });
    const input = BIBLE_INPUT();

    const bible = await synthesize(input);

    expect(requests).toHaveLength(12);
    expect(requests.every((r) => r.forceToolName === "emit_section")).toBe(true);
    // Each call carries its own section block plus the shared context.
    for (const [index, key] of MODEL_SECTION_KEYS.entries()) {
      expect(String(requests[index]?.user)).toContain(BIBLE_SECTIONS[key].instruction);
      expect(String(requests[index]?.user)).toContain("Chapter 2: Two.");
    }
    // Validators normalized the recoverable bare-string character profile.
    expect(bible.characterProfiles).toEqual([{ name: "Bare Name", profile: "" }]);
    expect(bible.bookOverview).toEqual(SECTION_VALUES.bookOverview);
    expect(bible.chapterSummaries).toEqual(input.summaries);
    // The graph derives from the input facts, not the model's sections.
    expect(bible.graph).toEqual({
      nodes: [{ name: "Bare Name", importance: 0, role: "protagonist" }],
      edges: [],
    });
  });

  it("retries a failing section inline and still assembles the bible", async () => {
    const groupsIndex = MODEL_SECTION_KEYS.indexOf("groups");
    const responses = [
      ...SECTION_RESPONSES.slice(0, groupsIndex),
      toolResponse({ value: { no_name: true } }),
      sectionResponse(SECTION_VALUES.groups),
      ...SECTION_RESPONSES.slice(groupsIndex + 1),
    ];
    const { client, requests } = scriptedClient(responses);
    const synthesize = createAgnesBibleSynthesizer(client, { strategy: "per-section" });

    const bible = await synthesize(BIBLE_INPUT());

    expect(requests).toHaveLength(13);
    expect(bible.groups).toEqual([]);
  });

  it("hard-fails when a section cannot be validated even after the retry", async () => {
    const groupsIndex = MODEL_SECTION_KEYS.indexOf("groups");
    const responses = [
      ...SECTION_RESPONSES.slice(0, groupsIndex),
      toolResponse({ value: { no_name: true } }),
      toolResponse({ value: 42 }),
    ];
    const { client } = scriptedClient(responses);
    const synthesize = createAgnesBibleSynthesizer(client, { strategy: "per-section" });

    await expect(synthesize(BIBLE_INPUT())).rejects.toThrow(
      /bible section groups retry after .* also failed/,
    );
  });
});

describe("createAgnesBibleSynthesizer — monolithic", () => {
  it("makes exactly one assemble_bible call with the master prompt and validates the flat payload", async () => {
    const { client, requests } = scriptedClient([
      bibleResponse({
        book_overview: SECTION_VALUES.bookOverview,
        world: [],
        character_profiles: [],
        location_profiles: [],
        thread_rollups: [],
        groups: [],
        items_of_significance: [],
        lexicon_notes: [],
        open_loops: [],
        style_rollup: [],
        world_timeline: [],
        book_timeline: [],
      }),
    ]);
    const synthesize = createAgnesBibleSynthesizer(client, { strategy: "monolithic" });
    const input = BIBLE_INPUT();

    const bible = await synthesize(input);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.forceToolName).toBe("assemble_bible");
    const prompt = String(requests[0]?.user);
    expect(prompt).toContain("book_overview:");
    expect(prompt).toContain("book_timeline:");
    expect(bible.bookOverview).toEqual(SECTION_VALUES.bookOverview);
    expect(bible.chapterSummaries).toEqual(input.summaries);
  });

  it("hard-fails a payload missing sections — nothing silently reaches the bible", async () => {
    const { client, requests } = scriptedClient([
      bibleResponse({ book_overview: SECTION_VALUES.bookOverview }),
      bibleResponse({ book_overview: SECTION_VALUES.bookOverview }),
    ]);
    const synthesize = createAgnesBibleSynthesizer(client, { strategy: "monolithic" });

    await expect(synthesize(BIBLE_INPUT())).rejects.toThrow(
      /bible assembly retry after .*also failed.*missing section/,
    );
    expect(requests).toHaveLength(2);
  });
});

describe("synthesis response cache", () => {
  it("serves identical monolithic assemblies from cache and keeps strategies apart", async () => {
    let calls = 0;
    const responses = [
      bibleResponse({
        book_overview: SECTION_VALUES.bookOverview,
        world: [],
        character_profiles: [],
        location_profiles: [],
        thread_rollups: [],
        groups: [],
        items_of_significance: [],
        lexicon_notes: [],
        open_loops: [],
        style_rollup: [],
        world_timeline: [],
        book_timeline: [],
      }),
      ...SECTION_RESPONSES,
    ];
    const client: AgnesClient = {
      model: "agnes-2.5-flash",
      async complete() {
        return responses[calls++];
      },
    };
    const cache = new MemoryResponseCache();
    const input = BIBLE_INPUT();

    const monolithic = createAgnesBibleSynthesizer(client, {
      responseCache: cache,
      strategy: "monolithic",
    });
    const first = await monolithic(input);
    const second = await monolithic(input);
    expect(calls).toBe(1);
    expect(second).toEqual(first);

    const perSection = createAgnesBibleSynthesizer(client, {
      responseCache: cache,
      strategy: "per-section",
    });
    await perSection(input);
    expect(calls).toBe(13);
  });

  it("re-validates cache hits at the trust boundary — cached garbage fails loudly", async () => {
    const cache = new MemoryResponseCache();
    const client: AgnesClient = {
      model: "agnes-2.5-flash",
      async complete() {
        return bibleResponse({ book_overview: SECTION_VALUES.bookOverview });
      },
    };
    const synthesize = createAgnesBibleSynthesizer(client, {
      responseCache: cache,
      strategy: "monolithic",
    });

    await expect(synthesize(BIBLE_INPUT())).rejects.toThrow(/missing section/);
  });
});
