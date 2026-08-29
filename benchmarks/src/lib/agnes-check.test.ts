import { describe, expect, it } from "vitest";
import type { AgnesClient, ChatCompletionRequest } from "./agnes-client.js";
import { createAgnesCheck, parseCheckerFlags } from "./agnes-check.js";
import { emptyStoryFacts } from "./story-facts.js";
import { applyFact } from "./fact-merge.js";

function scriptedClient(response: unknown): {
  client: AgnesClient;
  request: Promise<ChatCompletionRequest>;
} {
  let captured: ChatCompletionRequest | undefined;
  const client: AgnesClient = {
    model: "scripted",
    async complete(request) {
      captured = request;
      return response;
    },
  };
  return {
    client,
    request: (async () => {
      while (captured === undefined) await new Promise((r) => setTimeout(r, 0));
      return captured;
    })(),
  };
}

function toolResponse(flags: unknown): unknown {
  return {
    choices: [
      { message: { tool_calls: [{ function: { arguments: JSON.stringify({ flags }) } }] } },
    ],
  };
}

function scriptedSequence(responses: readonly unknown[]): {
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

describe("createAgnesCheck", () => {
  it("maps forced-tool verdicts into checker flags against rendered canon", async () => {
    const { client, request } = scriptedClient(
      toolResponse([{ kind: "item", message: 'canon says Mara holds the compass; text says Ilya' }]),
    );
    const canon = applyFact(emptyStoryFacts(), {
      kind: "item",
      item: "brass compass",
      holder: "Mara Vey",
    });

    const result = await createAgnesCheck(client)(
      canon,
      "The compass rests with Ilya Fen.",
    );

    expect(result.flags).toEqual([
      { kind: "item", message: "canon says Mara holds the compass; text says Ilya" },
    ]);
    const sent = await request;
    expect(sent.forceToolName).toBe("record_flags");
    expect(String(sent.user)).toContain("Canon established so far:");
    expect(String(sent.user)).toContain('item "brass compass" is held by "Mara Vey"');
  });

  it("reports zero flags for clean text against an empty canon", async () => {
    const { client } = scriptedClient(toolResponse([]));
    const result = await createAgnesCheck(client)(emptyStoryFacts(), "Anything goes.");
    expect(result.flags).toEqual([]);
  });

  it("retries once with the validation error attached when the first response is malformed", async () => {
    const { client, requests } = scriptedSequence([
      toolResponse([{ kind: "gods", message: "clash" }]),
      toolResponse([{ kind: "item", message: "canon says Mara holds the compass" }]),
    ]);
    const result = await createAgnesCheck(client)(emptyStoryFacts(), "The compass moved on.");
    expect(result.flags).toEqual([{ kind: "item", message: "canon says Mara holds the compass" }]);
    expect(requests).toHaveLength(2);
    expect(String(requests[1]?.user)).toContain("rejected by validation");
  });
});

describe("parseCheckerFlags — trust-boundary validation", () => {
  it("rejects malformed payloads precisely", () => {
    expect(() => parseCheckerFlags("junk")).toThrow(/not valid JSON/);
    expect(() => parseCheckerFlags('{"flags": null}')).toThrow(/"flags" array/);
    expect(() => parseCheckerFlags(JSON.stringify({ flags: [{ kind: "gods" }] }))).toThrow(
      /"kind" must be one of/u,
    );
    expect(() =>
      parseCheckerFlags(JSON.stringify({ flags: [{ kind: "item", message: "", note: "x" }] })),
    ).toThrow(/unexpected field "note"|"message" must be a non-empty string/u);
  });

  it("accepts well-formed flags", () => {
    const flags = parseCheckerFlags(
      JSON.stringify({ flags: [{ kind: "thread", message: "status clash" }] }),
    );
    expect(flags).toEqual([{ kind: "thread", message: "status clash" }]);
  });
});
