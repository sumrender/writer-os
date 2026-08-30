import type { GraphData, GraphNode } from "./story-bible.js";
import type { StoryFacts } from "./story-facts.js";
import { wholeNameRegExp } from "./name-text.js";

/**
 * Deterministic graph-data derivation (issue #14): the data layer of the
 * relationship graph, produced from Story Facts alone so the Relationship
 * Graph ticket only owns the interactive UI. Nodes mirror characters with
 * whole-name occurrence importance; edges mirror relationship facts 1:1.
 * Role on the node is the single source of protagonist truth — there is no
 * top-level protagonist field (DRY).
 */

/** Case-sensitive whole-name occurrence count: letter boundaries on both sides. */
function countOccurrences(chapterTexts: readonly string[], name: string): number {
  const pattern = wholeNameRegExp(name);
  let count = 0;
  for (const text of chapterTexts) {
    count += text.split(pattern).length - 1;
  }
  return count;
}

interface GraphDerivationInput {
  readonly facts: StoryFacts;
  readonly chapterTexts: readonly string[];
}

export function deriveGraphData({ facts, chapterTexts }: GraphDerivationInput): GraphData {
  const nodes: GraphNode[] = facts.characters.map((character) => ({
    name: character.name,
    importance: countOccurrences(chapterTexts, character.name),
    role: "supporting",
  }));

  const knownNames = new Set(nodes.map((node) => node.name));
  for (const relationship of facts.relationships) {
    for (const endpoint of [relationship.from, relationship.to]) {
      if (!knownNames.has(endpoint)) {
        knownNames.add(endpoint);
        nodes.push({ name: endpoint, importance: 0, role: "supporting" });
      }
    }
  }

  // The protagonist is the character node with the highest importance, ties
  // broken by character order. Appended relationship endpoints are never
  // candidates — they are not characters.
  const candidates = nodes.slice(0, facts.characters.length);
  const protagonist = candidates.reduce<GraphNode | undefined>(
    (best, node) => (best === undefined || node.importance > best.importance ? node : best),
    undefined,
  );
  if (protagonist !== undefined) {
    nodes[nodes.indexOf(protagonist)] = { ...protagonist, role: "protagonist" };
  }

  return {
    nodes,
    edges: facts.relationships.map((relationship) => ({
      from: relationship.from,
      to: relationship.to,
      relation: relationship.relationType,
    })),
  };
}
