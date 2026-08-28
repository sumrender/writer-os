import { describe, expect, it } from "vitest";
import type { AgnesClient } from "./agnes-client.js";
import {
  EQUIVALENCE_TOOL,
  JUDGE_MODEL,
  SUPPORT_TOOL,
  createLiveJudge,
  equivalenceSystemPrompt,
  equivalenceUserPrompt,
  parseVerdictArguments,
  supportSystemPrompt,
  supportUserPrompt,
} from "./live-judge.js";

describe("prompt construction", () => {
  it("embeds both values in the equivalence prompt with the fixed rubric", () => {
    const prompt = equivalenceUserPrompt({ left: "half-brother", right: "brother" });
    expect(prompt).toContain("half-brother");
    expect(prompt).toContain("brother");
    expect(prompt).toContain("equivalent");
  });

  it("keeps the rubric fixed in the system prompt, absent fixture text", () => {
    const system = equivalenceSystemPrompt();
    expect(system).toContain("equivalence");
    expect(system).not.toContain("chapter");
    expect(system.toLowerCase()).toContain("only");
  });

  it("embeds fact and source text in the support prompt", () => {
    const prompt = supportUserPrompt({
      fact: 'item "brass compass" held by "Mara Vey"',
      sourceText: "[chapter 1]\nIntroducing Mara Vey",
    });
    expect(prompt).toContain("brass compass");
    expect(prompt).toContain("[chapter 1]");
  });

  it("declares forced single-argument verdict tools with closed enums", () => {
    expect(EQUIVALENCE_TOOL.function.name).toBe("record_verdict");
    const equivalenceEnum = EQUIVALENCE_TOOL.function.parameters.properties.verdict.enum;
    expect(equivalenceEnum).toEqual(["equivalent", "not_equivalent"]);
    const supportEnum = SUPPORT_TOOL.function.parameters.properties.verdict.enum;
    expect(supportEnum).toEqual(["supported", "unsupported"]);
    expect(supportSystemPrompt()).toContain("explicitly");
  });
});

describe("parseVerdictArguments", () => {
  it("maps the positive label to true and negative to false", () => {
    expect(parseVerdictArguments('{"verdict":"equivalent"}', "equivalent", "not_equivalent")).toBe(
      true,
    );
    expect(
      parseVerdictArguments('{"verdict":"not_equivalent"}', "equivalent", "not_equivalent"),
    ).toBe(false);
    expect(parseVerdictArguments('{"verdict": "supported"}', "supported", "unsupported")).toBe(
      true,
    );
  });

  it("rejects malformed or out-of-contract responses precisely", () => {
    expect(() => parseVerdictArguments("not json", "a", "b")).toThrow(/valid JSON/);
    expect(() => parseVerdictArguments('{"other":1}', "a", "b")).toThrow(/verdict/);
    expect(() => parseVerdictArguments('{"verdict":"maybe"}', "a", "b")).toThrow(/maybe/);
    expect(() => parseVerdictArguments('"equivalent"', "a", "b")).toThrow(/object/i);
  });
});

describe("createLiveJudge", () => {
  it("refuses to construct without an API key", () => {
    expect(() => createLiveJudge({ apiKey: "" })).toThrow(/api key/i);
  });
});

describe("live judge verdict transport", () => {
  const toolCallResponse = (args: string): unknown => ({
    choices: [{ message: { tool_calls: [{ function: { arguments: args } }] } }],
  });
  const textOnlyResponse: unknown = {
    choices: [{ message: { content: "Let me think about that…" } }],
  };

  interface StubClient {
    readonly client: AgnesClient;
    calls(): number;
  }

  /** Client that replays scripted responses, repeating the last one forever. */
  function stubClient(responses: readonly unknown[]): StubClient {
    let count = 0;
    return {
      client: {
        model: JUDGE_MODEL,
        async complete() {
          const last = responses.length - 1;
          const index = Math.min(count, last);
          count++;
          const response = responses[index];
          if (response === undefined) throw new Error("stub ran out of scripted responses");
          return response;
        },
      },
      calls: () => count,
    };
  }

  it("retries once when the model answers without the forced tool call", async () => {
    const { client, calls } = stubClient([
      textOnlyResponse,
      toolCallResponse('{"verdict":"equivalent"}'),
    ]);
    const judge = createLiveJudge({ client });
    await expect(judge.areEquivalent({ left: "aunt", right: "aunt Polly" })).resolves.toBe(true);
    expect(calls()).toBe(2);
  });

  it("propagates with both problems attached when the retry also fails", async () => {
    const { client, calls } = stubClient([textOnlyResponse, textOnlyResponse]);
    const judge = createLiveJudge({ client });
    await expect(
      judge.areEquivalent({ left: "aunt", right: "aunt Polly" }),
    ).rejects.toThrow(/forced tool call[\s\S]*also failed|also failed[\s\S]*forced tool call/);
    expect(calls()).toBe(2);
  });

  it("does not re-ask when the first response is a valid verdict", async () => {
    const { client, calls } = stubClient([toolCallResponse('{"verdict":"not_equivalent"}')]);
    const judge = createLiveJudge({ client });
    await expect(judge.areEquivalent({ left: "aunt", right: "neighbor" })).resolves.toBe(false);
    expect(calls()).toBe(1);
  });

  it("applies the same retry to source-support verdicts", async () => {
    const { client, calls } = stubClient([
      toolCallResponse('{"verdict":"maybe"}'),
      toolCallResponse('{"verdict":"supported"}'),
    ]);
    const judge = createLiveJudge({ client });
    await expect(
      judge.isSupportedBySource({ fact: "Tom lives with Aunt Polly", sourceText: "[chapter 1]" }),
    ).resolves.toBe(true);
    expect(calls()).toBe(2);
  });
});
