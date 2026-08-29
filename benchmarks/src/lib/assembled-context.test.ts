import { describe, expect, it } from "vitest";
import { emptyStoryFacts } from "./story-facts.js";
import { renderAssembledContext } from "./assembled-context.js";

describe("renderAssembledContext", () => {
  it("renders an empty facts store as an explicit empty-canon marker", () => {
    expect(renderAssembledContext(emptyStoryFacts())).toBe("(no canon established yet)");
  });

  it("renders every established fact as one line, in facts order", () => {
    const state = {
      ...emptyStoryFacts(),
      characters: [{ name: "Mara Vey" }],
      items: [{ item: "brass compass", holder: "Mara Vey" }],
    };

    const rendered = renderAssembledContext(state);

    expect(rendered).toBe(
      ['character named "Mara Vey"', 'item "brass compass" is held by "Mara Vey"'].join("\n"),
    );
  });
});
