import type { GraphData, GraphNode } from "@writer-os/benchmark/events";

/**
 * The Relationship Graph's shared logic (issue #20): pure data shaping for
 * the interactive view, kept out of the component so it stays unit-testable.
 * The derived graph (bible-graph.ts) remains the single source of nodes,
 * edges, importance, and protagonist truth — this module only decides which
 * node the view is rooted on and where nodes sit relative to that root.
 * Edges are never reshaped here: the component renders the graph's edges
 * 1:1, so only relationship-fact connections can appear.
 */

/** Fixed node card size. Known up front so the radial layout never overlaps and SSR renders nodes immediately. */
export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 64;

/** Distance between consecutive BFS rings (root's direct connections sit on ring 1). */
const RING_STEP = 240;
/** Minimum ring circumference per node, so crowded rings grow outward instead of overlapping. */
const NODE_SPACING = 200;

/** One graph node positioned relative to the active root. */
export interface GraphViewNode {
  readonly name: string;
  readonly importance: number;
  readonly role: GraphNode["role"];
  readonly x: number;
  readonly y: number;
}

/**
 * The default root: the auto-detected protagonist (the derived graph's role
 * is the single source of that truth). Falls back to the first node for
 * degenerate graphs with no marked protagonist, and to null for an empty
 * graph — the view renders its "none yet" state then.
 */
export function defaultRoot(graph: GraphData): string | null {
  const protagonist = graph.nodes.find((node) => node.role === "protagonist");
  return protagonist?.name ?? graph.nodes[0]?.name ?? null;
}

/**
 * The active root: the requested one while the as-of-N graph still contains
 * it (re-rooting survives ordinal switches for characters that stay
 * established), otherwise the default root. This is the single place that
 * reconciles a chosen root with the character set of the current ordinal.
 */
export function resolveRoot(graph: GraphData, requested: string | null): string | null {
  if (requested !== null && graph.nodes.some((node) => node.name === requested)) {
    return requested;
  }
  return defaultRoot(graph);
}

/**
 * Radial BFS layout rooted on `root`: the root's box straddles the origin
 * (so centering the viewport on (0, 0) focuses it), direct connections sit
 * on the first ring, connections-of-connections further out. Characters
 * without any relationship fact land on the outermost ring so every node of
 * the as-of-N character set stays visible. Deterministic: rings are walked
 * in node order and angles derive from each ring's index/count only.
 */
export function layoutGraph(
  graph: GraphData,
  root: string | null,
): readonly GraphViewNode[] {
  if (root === null || graph.nodes.length === 0) return [];

  const adjacency = new Map<string, string[]>();
  for (const node of graph.nodes) adjacency.set(node.name, []);
  for (const edge of graph.edges) {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }

  const depth = new Map<string, number>([[root, 0]]);
  let frontier = [root];
  let currentDepth = 0;
  while (frontier.length > 0) {
    currentDepth += 1;
    const next: string[] = [];
    for (const name of frontier) {
      for (const neighbor of adjacency.get(name) ?? []) {
        if (!depth.has(neighbor)) {
          depth.set(neighbor, currentDepth);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }

  const rings = new Map<number, GraphNode[]>();
  const disconnected: GraphNode[] = [];
  for (const node of graph.nodes) {
    const nodeDepth = depth.get(node.name);
    if (nodeDepth === undefined) {
      disconnected.push(node);
    } else {
      const ring = rings.get(nodeDepth) ?? [];
      ring.push(node);
      rings.set(nodeDepth, ring);
    }
  }
  if (disconnected.length > 0) {
    rings.set(currentDepth, disconnected);
  }

  const positioned: GraphViewNode[] = [];
  for (const [ringDepth, ringNodes] of [...rings.entries()].sort((a, b) => a[0] - b[0])) {
    const radius =
      ringDepth === 0
        ? 0
        : Math.max(RING_STEP * ringDepth, (ringNodes.length * NODE_SPACING) / (2 * Math.PI));
    positioned.push(...ringNodes.map((node, index) => {
      const angle = (index / ringNodes.length) * 2 * Math.PI - Math.PI / 2;
      return {
        name: node.name,
        importance: node.importance,
        role: node.role,
        x: radius * Math.cos(angle) - NODE_WIDTH / 2,
        y: radius * Math.sin(angle) - NODE_HEIGHT / 2,
      };
    }));
  }
  return positioned;
}
