import type { CharacterProfile, GraphData } from "@writer-os/benchmark/events";

/**
 * The Characters section's shared logic (issue #15): pure data shaping from
 * the bible's character profiles and derived graph, kept out of the
 * component so it stays unit-testable. The graph node's role is the single
 * source of protagonist truth (bible-graph.ts) — the UI never re-derives it.
 */

/** One character prepared for the Characters section UI. */
export interface CharacterCard {
  readonly profile: CharacterProfile;
  /** Whole-name mention count from the derived graph (0 when unlisted). */
  readonly importance: number;
  /** Whether the derived graph casts this character as the protagonist. */
  readonly protagonist: boolean;
}

/**
 * Orders characters most-important first; ties stay in input order
 * (Array#sort is stable). Characters absent from the graph sort last with
 * importance 0 and no protagonist mark.
 */
export function orderCharacters(
  profiles: readonly CharacterProfile[],
  graph: GraphData,
): readonly CharacterCard[] {
  const nodes = new Map(graph.nodes.map((node) => [node.name, node]));
  return profiles
    .map((profile): CharacterCard => {
      const node = nodes.get(profile.name);
      return {
        profile,
        importance: node?.importance ?? 0,
        protagonist: node?.role === "protagonist",
      };
    })
    .sort((a, b) => b.importance - a.importance);
}
