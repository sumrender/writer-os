import { describe, expect, it } from "vitest";
import type { CharacterProfile, GraphData } from "@writer-os/benchmark/events";
import { orderCharacters } from "./characters.js";

/**
 * The Characters section's shared logic (issue #15): ordering characters by
 * graph importance with the auto-detected protagonist marked. Pure data
 * shaping — the derived graph is the single source of protagonist truth
 * (bible-graph.ts), so the UI never re-derives it.
 */

function profile(name: string, mentionOrdinals: readonly number[] = [1]): CharacterProfile {
  return {
    name,
    appearance: "",
    personality: "",
    definingTraits: [],
    background: "",
    arc: "",
    firstAppearanceOrdinal: mentionOrdinals[0] ?? 1,
    mentionOrdinals,
    relationships: [],
  };
}

function graphOf(
  nodes: readonly { name: string; importance: number; role?: "protagonist" | "supporting" }[],
): GraphData {
  return {
    nodes: nodes.map((node) => ({
      name: node.name,
      importance: node.importance,
      role: node.role ?? "supporting",
    })),
    edges: [],
  };
}

describe("orderCharacters", () => {
  it("orders by graph importance, most mentioned first, regardless of input order", () => {
    const cards = orderCharacters([profile("Joren Vey"), profile("Mara Vey")], graphOf([
      { name: "Mara Vey", importance: 5, role: "protagonist" },
      { name: "Joren Vey", importance: 4 },
    ]));
    expect(cards.map((card) => card.profile.name)).toEqual(["Mara Vey", "Joren Vey"]);
  });

  it("marks the character the graph casts as protagonist, and only that one", () => {
    const cards = orderCharacters([profile("Mara Vey"), profile("Joren Vey")], graphOf([
      { name: "Mara Vey", importance: 5, role: "protagonist" },
      { name: "Joren Vey", importance: 4 },
    ]));
    expect(cards.map((card) => card.protagonist)).toEqual([true, false]);
  });

  it("keeps input order for equal importance (stable ties)", () => {
    const cards = orderCharacters([profile("Joren Vey"), profile("Mara Vey")], graphOf([
      { name: "Mara Vey", importance: 2 },
      { name: "Joren Vey", importance: 2 },
    ]));
    expect(cards.map((card) => card.profile.name)).toEqual(["Joren Vey", "Mara Vey"]);
  });

  it("treats characters missing from the graph as importance 0, never protagonist, sorting last", () => {
    const cards = orderCharacters([profile("Pell Wynn"), profile("Mara Vey")], graphOf([
      { name: "Mara Vey", importance: 3 },
    ]));
    expect(cards.map((card) => card.profile.name)).toEqual(["Mara Vey", "Pell Wynn"]);
    expect(cards.map((card) => card.importance)).toEqual([3, 0]);
    expect(cards.map((card) => card.protagonist)).toEqual([false, false]);
  });

  it("carries the profile through untouched", () => {
    const mara = profile("Mara Vey", [1, 2, 4]);
    const [card] = orderCharacters([mara], graphOf([{ name: "Mara Vey", importance: 5 }]));
    expect(card?.profile).toEqual(mara);
    expect(card?.importance).toBe(5);
  });

  it("returns an empty list for an empty section", () => {
    expect(orderCharacters([], graphOf([]))).toEqual([]);
  });
});
