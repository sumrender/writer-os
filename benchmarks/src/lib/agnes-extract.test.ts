import { describe, expect, it } from "vitest";
import { emptyBible } from "./bible.js";
import type { AgnesClient, ChatCompletionRequest } from "./agnes-client.js";
import { createAgnesExtract, parseExtractedFacts, parseExtractedFactsDetailed } from "./agnes-extract.js";
import { MemoryResponseCache } from "./response-cache.js";

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

function toolResponse(facts: unknown): unknown {
  return {
    choices: [
      { message: { tool_calls: [{ function: { arguments: JSON.stringify({ facts }) } }] } },
    ],
  };
}

describe("createAgnesExtract", () => {
  it("merges model facts onto canon sequentially across chapters", async () => {
    const { client, requests } = scriptedClient([
      toolResponse([
        { kind: "character", name: "Mara Vey" },
        { kind: "item", item: "brass compass", holder: "Mara Vey" },
      ]),
      toolResponse([{ kind: "item", item: "brass compass", holder: "Ilya Fen" }]),
    ]);
    const extract = createAgnesExtract(client);

    const afterCh1 = await extract("Mara held the compass.", 1, emptyBible());
    expect(afterCh1.characters).toEqual([{ name: "Mara Vey" }]);
    expect(afterCh1.items).toEqual([{ item: "brass compass", holder: "Mara Vey" }]);

    const afterCh2 = await extract("Ilya took the compass.", 2, afterCh1);
    expect(afterCh2.items).toEqual([{ item: "brass compass", holder: "Ilya Fen" }]);

    // The prompt carried ordinal and prior canon so the model sees deltas.
    const secondPrompt = String(requests[1]?.user);
    expect(secondPrompt).toContain("Chapter ordinal: 2");
    expect(secondPrompt).toContain('item "brass compass" is held by "Mara Vey"');
    expect(requests[0]?.forceToolName).toBe("record_facts");
  });

  it("returns canon untouched when the chapter establishes nothing", async () => {
    const { client } = scriptedClient([toolResponse([])]);
    const state = await createAgnesExtract(client)("Nothing happened.", 1, emptyBible());
    expect(state).toEqual(emptyBible());
  });

  it("retries once with the validation error attached when the first response is malformed at batch level", async () => {
    // Whole-batch failure only: the model returned tool arguments that
    // are not valid JSON. Per-fact validation failures no longer trigger
    // a retry — they are skipped, and the rest of the batch keeps producing.
    const malformedArgs = "not json";
    const toolCall = { function: { arguments: malformedArgs } };
    const message = { tool_calls: [toolCall] };
    const choice = { message };
    const malformedResponse = { choices: [choice] };
    const { client, requests } = scriptedClient([
      malformedResponse,
      toolResponse([{ kind: "item", item: "brass compass", holder: "Mara Vey" }]),
    ]);
    const state = await createAgnesExtract(client)("Mara held the compass.", 1, emptyBible());
    expect(state.items).toEqual([{ item: "brass compass", holder: "Mara Vey" }]);
    expect(requests).toHaveLength(2);
    expect(String(requests[1]?.user)).toContain("rejected by validation");
  });

  it("keeps partial facts when a skip-recovery retry fails at batch level", async () => {
    // Per-fact failures are isolated, but they now trigger one recovery retry.
    // When that retry itself fails at batch level, the first attempt's valid
    // facts still land — a failed salvage never discards partial work.
    const { client, requests } = scriptedClient([
      toolResponse([
        { kind: "character", name: "Mara Vey" },
        { kind: "wizards", name: "Mara Vey" },
      ]),
      { choices: [{ message: { tool_calls: [{ function: { arguments: "not json" } }] } }] },
    ]);
    const state = await createAgnesExtract(client)("Mara held the compass.", 1, emptyBible());
    expect(state.characters).toEqual([{ name: "Mara Vey" }]);
    expect(requests).toHaveLength(2);
    expect(String(requests[1]?.user)).toContain("rejected by validation");
  });

  it("retries once to recover skipped facts and adopts the corrected batch", async () => {
    const { client, requests } = scriptedClient([
      toolResponse([
        { kind: "character", name: "Mara Vey" },
        { kind: "wizards", name: "Mara Vey" },
      ]),
      toolResponse([
        { kind: "character", name: "Mara Vey" },
        { kind: "item", item: "brass compass", holder: "Mara Vey" },
      ]),
    ]);
    const state = await createAgnesExtract(client)("Mara held the compass.", 1, emptyBible());
    expect(state.characters).toEqual([{ name: "Mara Vey" }]);
    expect(state.items).toEqual([{ item: "brass compass", holder: "Mara Vey" }]);
    expect(requests).toHaveLength(2);
    expect(String(requests[1]?.user)).toContain("#1");
  });

  it("keeps the first batch when the recovery retry skips more facts", async () => {
    const { client, requests } = scriptedClient([
      toolResponse([
        { kind: "character", name: "Mara Vey" },
        { kind: "wizards", name: "Mara Vey" },
      ]),
      toolResponse([{ kind: "wizards", name: "Mara Vey" }]),
    ]);
    const state = await createAgnesExtract(client)("Mara held the compass.", 1, emptyBible());
    expect(state.characters).toEqual([{ name: "Mara Vey" }]);
    expect(requests).toHaveLength(2);
  });

  it("does not retry a fully valid batch", async () => {
    const { client, requests } = scriptedClient([
      toolResponse([{ kind: "character", name: "Mara Vey" }]),
    ]);
    const state = await createAgnesExtract(client)("Mara appeared.", 1, emptyBible());
    expect(state.characters).toEqual([{ name: "Mara Vey" }]);
    expect(requests).toHaveLength(1);
  });

  it("serves identical repeat extractions from the cache without new client calls", async () => {
    let calls = 0;
    const client: AgnesClient = {
      model: "agnes-2.5-flash",
      async complete() {
        calls++;
        return toolResponse([{ kind: "character", name: "Mara Vey" }]);
      },
    };
    const cache = new MemoryResponseCache();
    const extract = createAgnesExtract(client, { responseCache: cache });

    const first = await extract("Mara appeared.", 1, emptyBible());
    const second = await extract("Mara appeared.", 1, emptyBible());

    expect(calls).toBe(1); // the second identical call never reached the client
    expect(second).toEqual(first);
    expect(second.characters).toEqual([{ name: "Mara Vey" }]);
  });
});

describe("parseExtractedFacts — trust-boundary validation", () => {
  it("rejects non-JSON or wrongly shaped arguments precisely", () => {
    expect(() => parseExtractedFacts("not json")).toThrow(/not valid JSON/);
    expect(() => parseExtractedFacts('{"facts": 3}')).toThrow(/"facts" array/);
  });

  it("drops another kind's stray field as schema noise instead of failing", () => {
    // Agnes cannot enforce per-kind shapes at generation time, so models
    // sometimes redundantly carry e.g. `character` on a character fact.
    const facts = parseExtractedFacts(
      JSON.stringify({
        facts: [
          { kind: "character", name: "Mara Vey", character: "Mara Vey", status: "resolved" },
        ],
      }),
    );
    expect(facts).toEqual([{ kind: "character", name: "Mara Vey" }]);
  });

  it("still hard-fails on genuinely unknown fields and reports the raw fact", () => {
    const result = parseExtractedFactsDetailed(
      JSON.stringify({ facts: [{ kind: "character", name: "A", wizardry: 1 }] }),
    );
    expect(result.facts).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.index).toBe(0);
    expect(result.skipped[0]?.reason).toMatch(/unexpected field "wizardry"/u);
    // The truncated raw-fact snippet is carried separately for log diagnosability.
    expect(result.skipped[0]?.snippet).toContain("wizardry");
  });

  it("reports the raw fact on every rejection, including invalid kinds", () => {
    const result = parseExtractedFactsDetailed(
      JSON.stringify({ facts: [{ kind: "location", place: "the harbor" }] }),
    );
    expect(result.facts).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.index).toBe(0);
    expect(result.skipped[0]?.reason).toMatch(/fact #0.*"kind" must be one of/u);
  });

  it("canonicalizes a missing kind whose fields resolve to exactly one kind", () => {
    // Vendor noise observed live: the model occasionally drops `kind` entirely.
    // When the remaining keys ARE one kind's exact field set, infer it.
    expect(
      parseExtractedFacts(
        JSON.stringify({ facts: [{ item: "brass compass", holder: "Mara Vey" }] }),
      ),
    ).toEqual([{ kind: "item", item: "brass compass", holder: "Mara Vey" }]);
    expect(parseExtractedFacts(JSON.stringify({ facts: [{ name: "Mara Vey" }] }))).toEqual([
      { kind: "character", name: "Mara Vey" },
    ]);
  });

  it("still rejects a missing kind whose fields match no kind at all", () => {
    // No kind's field set contains a genuine stranger.
    const result = parseExtractedFactsDetailed(
      JSON.stringify({ facts: [{ sorcery: "dark" }] }),
    );
    expect(result.facts).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.index).toBe(0);
    expect(result.skipped[0]?.reason).toMatch(
      /"kind" is missing and its fields .* do not match exactly one fact kind/u,
    );
  });

  it("canonicalizes a thread whose identity arrived under name", () => {
    // Vendor-observed live: {"kind":"thread","name":...,"status":"open"} — with
    // status present, `name` can only be the thread's label.
    expect(
      parseExtractedFacts(
        JSON.stringify({ facts: [{ kind: "thread", name: "the light keeper", status: "open" }] }),
      ),
    ).toEqual([{ kind: "thread", thread: "the light keeper", status: "open" }]);
  });

  it("canonicalizes a bare character mention", () => {
    expect(parseExtractedFacts(JSON.stringify({ facts: [{ character: "Mara Vey" }] }))).toEqual([
      { kind: "character", name: "Mara Vey" },
    ]);
  });

  it("canonicalizes a character fact whose identity arrived under character", () => {
    // Vendor-observed live on tom-sawyer: {"kind":"character","character":"Peter"}
    expect(
      parseExtractedFacts(JSON.stringify({ facts: [{ kind: "character", character: "Peter" }] })),
    ).toEqual([{ kind: "character", name: "Peter" }]);
  });

  it("tolerates explicit-null text fields as empty, but only for those keys", () => {
    // Vendor-observed live: {"kind":"appearance",…,"contains":null} means "none".
    expect(
      parseExtractedFacts(
        JSON.stringify({
          facts: [{ kind: "appearance", character: "Peter", attribute: "yellow cat", contains: null }],
        }),
      ),
    ).toEqual([{ kind: "appearance", character: "Peter", attribute: "yellow cat", contains: "" }]);
    // A model-typed empty string for `contains` is now also tolerated:
    // the fact stays in canon with contains="". The grader's exact-match
    // against any assertion expecting real text surfaces this as an
    // omission, so the trust boundary is preserved end-to-end.
    expect(
      parseExtractedFacts(
        JSON.stringify({
          facts: [{ kind: "appearance", character: "P", attribute: "a", contains: "" }],
        }),
      ),
    ).toEqual([{ kind: "appearance", character: "P", attribute: "a", contains: "" }]);
  });

  it("canonicalizes a partial appearance whose subset of fields resolves uniquely", () => {
    // Vendor-observed live on tom-sawyer: {"character":"The Sheriff","contains":"graveyard"}
    // — every field name maps to exactly one kind, so the omission is resolvable.
    expect(
      parseExtractedFacts(
        JSON.stringify({ facts: [{ character: "The Sheriff", contains: "graveyard" }] }),
      ),
    ).toEqual([{ kind: "appearance", character: "The Sheriff", attribute: "", contains: "graveyard" }]);
  });

  it("unwraps a fact nested under its kind name", () => {
    // Vendor-observed live on tom-sawyer: {"appearance":{"attribute":…,…}}
    expect(
      parseExtractedFacts(
        JSON.stringify({
          facts: [
            { appearance: { attribute: "stolid face", character: "Injun Joe", contains: "graveyard" } },
          ],
        }),
      ),
    ).toEqual([
      { kind: "appearance", character: "Injun Joe", attribute: "stolid face", contains: "graveyard" },
    ]);
  });

  it("rejects unknown kinds, extra fields, bad statuses, and non-boolean flags with the fact index", () => {
    // Each entry below skips a single fact with a precise reason; the rest
    // of the batch keeps producing facts. Whole-batch failure (non-JSON,
    // missing `facts` array) still throws — see the earlier test.
    const expectSkip = (input: unknown, reasonPattern: RegExp): void => {
      const result = parseExtractedFactsDetailed(JSON.stringify({ facts: [input] }));
      expect(result.facts).toEqual([]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]?.reason).toMatch(reasonPattern);
    };
    expectSkip({ kind: "wizards", name: "x" }, /fact #0.*"kind" must be one of/u);
    expectSkip({ kind: "character", name: "A", extra: 1 }, /unexpected field "extra"/u);
    expectSkip({ kind: "thread", thread: "t", status: "collapsed" }, /"status" must be one of/u);
    // The lexicon case has been made tolerant: missing lockedSpelling
    // defaults to true (per the system prompt's "preserve source
    // spellings exactly"); "yes"/"locked"/"1" coerce to true. Only
    // non-coercible values still skip.
    expectSkip(
      { kind: "lexicon", term: "Vess", lockedSpelling: { nested: "yes" } },
      /"lockedSpelling" must be true or false/u,
    );
    expectSkip(
      { kind: "style", field: "tense", value: "" },
      /"value" must be a non-empty string/u,
    );
  });

  it("unwraps a fact nested under its kind name when kind is also set", () => {
    // Vendor-observed live on tom-sawyer chapter 1: the model returned
    // {"appearance":{"attribute":…,"character":…},"kind":"appearance"}.
    // The wrapper key matches the explicit kind, so the payload is the
    // sub-object — without unwrapping, `contains` is missing and the batch dies.
    // Here the wrapped sub-object carries all three required fields, so the
    // fact parses cleanly after unwrapping.
    expect(
      parseExtractedFacts(
        JSON.stringify({
          facts: [
            {
              appearance: {
                attribute: "jam on hands and mouth",
                character: "Tom Sawyer",
                contains: "sticky fingers",
              },
              kind: "appearance",
            },
          ],
        }),
      ),
    ).toEqual([
      {
        kind: "appearance",
        character: "Tom Sawyer",
        attribute: "jam on hands and mouth",
        contains: "sticky fingers",
      },
    ]);
  });

  it("does not unwrap when the kind's required fields are already siblings", () => {
    // A stray `appearance:{}` sub-object alongside a complete appearance fact
    // is dropped by rejectExtraFields, not treated as the canonical payload.
    const facts = parseExtractedFacts(
      JSON.stringify({
        facts: [
          {
            kind: "appearance",
            character: "Tom Sawyer",
            attribute: "a",
            contains: "c",
            appearance: { noise: 1 },
          },
        ],
      }),
    );
    expect(facts).toEqual([{ kind: "appearance", character: "Tom Sawyer", attribute: "a", contains: "c" }]);
  });

  it("isolates per-fact failures: a single bad fact never kills the batch", () => {
    // Live-observed: one unfixable fact in a 30-fact response used to throw
    // and abort the whole chapter. Now it's skipped and the rest proceeds.
    const result = parseExtractedFactsDetailed(
      JSON.stringify({
        facts: [
          { kind: "character", name: "Tom Sawyer" },
          { kind: "wizards", name: "Mara Vey" },
          { kind: "timeline", event: "Tom painted the fence" },
        ],
      }),
    );
    expect(result.facts).toEqual([
      { kind: "character", name: "Tom Sawyer" },
      { kind: "timeline", event: "Tom painted the fence" },
    ]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.index).toBe(1);
    expect(result.skipped[0]?.reason).toMatch(/"kind" must be one of/u);
  });

  it("accepts a well-formed mixed batch and preserves exact typing", () => {
    const facts = parseExtractedFacts(
      JSON.stringify({
        facts: [
          { kind: "character", name: "Mara Vey" },
          { kind: "timeline", event: "the harbor burned" },
          { kind: "lexicon", term: "Vess", lockedSpelling: true },
        ],
      }),
    );
    expect(facts).toHaveLength(3);
    expect(facts[1]).toEqual({ kind: "timeline", event: "the harbor burned" });
  });
});
