import type { StoryFacts } from "./story-facts.js";
import { storyFacts } from "./fact-text.js";

/**
 * Renders a facts state as the assembled-context string a real generator
 * would condition on (docs/TESTING.md §8, pipeline.ts `GenerationContext`).
 * Reuses the same fact rendering the open-world sweep judges against, so the
 * checker-mediated path exercises the identical context-assembly rules that
 * would fail visibly on a real assembly bug.
 */
export function renderAssembledContext(state: StoryFacts): string {
  const facts = storyFacts(state);
  if (facts.length === 0) return "(no canon established yet)";
  return facts.map((fact) => fact.text).join("\n");
}
