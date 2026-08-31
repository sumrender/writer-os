import { describe, expect, it } from "vitest";
import type { GraphData } from "@writer-os/benchmark/events";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  defaultRoot,
  layoutGraph,
  resolveRoot,
} from "./graph-view.js";

/**
 * The Relationship Graph's shared logic (issue #20): the active root and the
 * radial re-rooting layout, pure data shaping kept out of the component so
 * it stays unit-testable. The derived graph (bible-graph.ts) stays the
 * single source of nodes, edges, importance, and protagonist truth — the
 * view never re-derives them and never fabricates a connection.
 */

function graphOf(
  nodes: readonly { name: string; importance?: number; role?: "protagonist" | "supporting" }[],
  edges: readonly { from: string; to: string; relation: string }[] = [],
): GraphData {
  return {
    nodes: nodes.map((node) => ({
      name: node.name,
      importance: node.importance ?? 0,
      role: node.role ?? "supporting",
    })),
    edges: edges.map((edge) => ({ from: edge.from, to: edge.to, relation: edge.relation })),
  };
}

const MINI_BOOK: GraphData = graphOf(
  [
    { name: "Mara Vey", importance: 5, role: "protagonist" },
    { name: "Joren Vey", importance: 4 },
    { name: "Tamsin Roe", importance: 1 },
  ],
  [
    { from: "Mara Vey", to: "Joren Vey", relation: "daughter" },
    { from: "Joren Vey", to: "Mara Vey", relation: "father" },
    { from: "Joren Vey", to: "Tamsin Roe", relation: "rival" },
  ],
);

describe("defaultRoot", () => {
  it("returns the auto-detected protagonist as the default root", () => {
    expect(defaultRoot(MINI_BOOK)).toBe("Mara Vey");
  });

  it("falls back to the first node when no protagonist is marked", () => {
    const unmarked = graphOf([{ name: "Joren Vey" }, { name: "Mara Vey" }]);
    expect(defaultRoot(unmarked)).toBe("Joren Vey");
  });

  it("returns null for an empty graph", () => {
    expect(defaultRoot(graphOf([]))).toBeNull();
  });
});

describe("resolveRoot", () => {
  it("keeps the requested root while the as-of-N graph still contains it", () => {
    expect(resolveRoot(MINI_BOOK, "Tamsin Roe")).toBe("Tamsin Roe");
  });

  it("falls back to the default root when the requested character is not established at this ordinal", () => {
    const asOfOne = graphOf([
      { name: "Mara Vey", importance: 3, role: "protagonist" },
      { name: "Joren Vey", importance: 2 },
    ]);
    expect(resolveRoot(asOfOne, "Tamsin Roe")).toBe("Mara Vey");
  });

  it("resolves a null request to the default root", () => {
    expect(resolveRoot(MINI_BOOK, null)).toBe("Mara Vey");
  });

  it("resolves to null only when the graph has no nodes at all", () => {
    expect(resolveRoot(graphOf([]), "Mara Vey")).toBeNull();
  });
});

describe("layoutGraph", () => {
  it("centers the root: its node box straddles the origin", () => {
    const [root] = layoutGraph(MINI_BOOK, "Mara Vey").filter((n) => n.name === "Mara Vey");
    expect(root?.x).toBe(-NODE_WIDTH / 2);
    expect(root?.y).toBe(-NODE_HEIGHT / 2);
  });

  it("places direct connections on the first ring and second-degree connections further out", () => {
    const positions = new Map(layoutGraph(MINI_BOOK, "Mara Vey").map((n) => [n.name, n]));
    const root = positions.get("Mara Vey");
    const joren = positions.get("Joren Vey");
    const tamsin = positions.get("Tamsin Roe");
    if (root === undefined || joren === undefined || tamsin === undefined) {
      throw new Error("every graph node must be positioned");
    }
    const distance = (n: { x: number; y: number }): number =>
      Math.hypot(n.x + NODE_WIDTH / 2, n.y + NODE_HEIGHT / 2);
    const jorenDistance = distance(joren);
    const tamsinDistance = distance(tamsin);
    expect(jorenDistance).toBeGreaterThan(0);
    expect(tamsinDistance).toBeGreaterThan(jorenDistance);
  });

  it("positions every node exactly once, disconnected characters included", () => {
    const isolated = graphOf(
      [
        { name: "Mara Vey", importance: 5, role: "protagonist" },
        { name: "Joren Vey", importance: 4 },
        { name: "Hollow Stranger", importance: 0 },
      ],
      [{ from: "Mara Vey", to: "Joren Vey", relation: "daughter" }],
    );
    const positioned = layoutGraph(isolated, "Mara Vey");
    expect(positioned.map((n) => n.name).sort()).toEqual([
      "Hollow Stranger",
      "Joren Vey",
      "Mara Vey",
    ]);
    const names = positioned.map((n) => n.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("re-rooting moves the focus: the new root is centered and the old root joins its first ring", () => {
    const positions = new Map(layoutGraph(MINI_BOOK, "Joren Vey").map((n) => [n.name, n]));
    expect(positions.get("Joren Vey")?.x).toBe(-NODE_WIDTH / 2);
    expect(positions.get("Joren Vey")?.y).toBe(-NODE_HEIGHT / 2);
    const mara = positions.get("Mara Vey");
    if (mara === undefined) {
      throw new Error("the former root must still be positioned");
    }
    const distance = Math.hypot(
      mara.x + NODE_WIDTH / 2,
      mara.y + NODE_HEIGHT / 2,
    );
    expect(distance).toBeGreaterThan(0);
    const maraCentered = layoutGraph(MINI_BOOK, "Mara Vey").find((n) => n.name === "Mara Vey");
    expect(maraCentered).toBeDefined();
    expect(distance).not.toBe(
      Math.hypot(
        (maraCentered?.x ?? 0) + NODE_WIDTH / 2,
        (maraCentered?.y ?? 0) + NODE_HEIGHT / 2,
      ),
    );
  });

  it("keeps node facts (importance, role) on the positioned nodes untouched", () => {
    const positioned = layoutGraph(MINI_BOOK, "Mara Vey");
    const mara = positioned.find((n) => n.name === "Mara Vey");
    expect(mara?.importance).toBe(5);
    expect(mara?.role).toBe("protagonist");
  });

  it("does not duplicate a character for parallel relationship facts between the same pair", () => {
    const positioned = layoutGraph(MINI_BOOK, "Mara Vey");
    const maraNeighbors = positioned.filter(
      (n) => n.name === "Joren Vey",
    );
    expect(maraNeighbors).toHaveLength(1);
  });

  it("separates same-ring characters into distinct positions", () => {
    const positioned = layoutGraph(MINI_BOOK, "Joren Vey");
    const ring = positioned.filter((n) => n.name !== "Joren Vey");
    const distinct = new Set(ring.map((n) => `${n.x},${n.y}`));
    expect(distinct.size).toBe(ring.length);
  });

  it("is deterministic: identical input yields identical positions", () => {
    expect(layoutGraph(MINI_BOOK, "Mara Vey")).toEqual(layoutGraph(MINI_BOOK, "Mara Vey"));
  });

  it("returns an empty layout for an empty graph", () => {
    expect(layoutGraph(graphOf([]), null)).toEqual([]);
  });
});
