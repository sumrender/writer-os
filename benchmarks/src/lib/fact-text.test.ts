import { describe, expect, it } from "vitest";
import { emptyBible } from "./bible.js";
import { bibleFacts } from "./fact-text.js";

describe("bibleFacts", () => {
  it("flattens every entity kind into a keyed, human-readable fact", () => {
    const state = {
      ...emptyBible(),
      characters: [{ name: "Mara Vey" }],
      appearances: [{ character: "Mara Vey", attribute: "her coat", contains: "salt-white wool" }],
      relationships: [{ from: "Mara Vey", to: "Joren Vey", relationType: "daughter" }],
      items: [{ item: "brass compass", holder: "Joren Vey" }],
      threads: [{ thread: "the missing ledger", status: "resolved" as const }],
      worldRules: [{ topic: "the northern light burns without oil" }],
      timeline: ["the ledger burned"],
      lexicon: [{ term: "Vess", lockedSpelling: true }],
      style: [{ field: "narration", value: "close third person, past tense" }],
    };

    const facts = bibleFacts(state);
    const byText = Object.fromEntries(facts.map((f) => [f.entityKind, f.text]));

    expect(byText.character).toBe('character named "Mara Vey"');
    expect(byText.appearance).toContain("her coat");
    expect(byText.appearance).toContain("salt-white wool");
    expect(byText.relationship).toContain('"daughter"');
    expect(byText.item).toContain("brass compass");
    expect(byText.item).toContain("Joren Vey");
    expect(byText.thread).toContain("the missing ledger");
    expect(byText.world_rule).toContain("northern light");
    expect(byText.timeline).toContain("the ledger burned");
    expect(byText.lexicon).toContain("Vess");
    expect(byText.style).toContain("close third person");
  });

  it("gives each fact a stable content key that distinguishes payloads", () => {
    const [before] = bibleFacts({
      ...emptyBible(),
      items: [{ item: "brass compass", holder: "Mara Vey" }],
    });
    const [after] = bibleFacts({
      ...emptyBible(),
      items: [{ item: "brass compass", holder: "Joren Vey" }],
    });
    const [again] = bibleFacts({
      ...emptyBible(),
      items: [{ item: "brass compass", holder: "Mara Vey" }],
    });

    expect(before?.key).toBeTruthy();
    expect(before?.key).not.toBe(after?.key);
    expect(before?.key).toBe(again?.key);
    expect(before?.key.startsWith("item:")).toBe(true);
  });
});
