import { describe, expect, it } from "vitest";
import {
  EQUIVALENCE_TOOL,
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
