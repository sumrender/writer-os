import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type BuiltInEdge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import type { CharacterProfile, GraphData, GraphNode } from "@writer-os/benchmark/events";
import { CharacterDetail } from "./Characters.js";
import { orderCharacters, type CharacterCard } from "../shared/characters.js";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  layoutGraph,
  resolveRoot,
} from "../shared/graph-view.js";

/**
 * The Relationship Graph section of the Story Bible (issue #20): the
 * interactive view over the baseline's derived graph data. The
 * auto-detected protagonist is the default root, centered on mount;
 * clicking any character re-roots the radial layout on them (the viewport
 * follows) and opens their full profile in the side panel. Nodes carry
 * fixed dimensions — known up front, so the layout never overlaps and SSR
 * renders without measuring. Edges render 1:1 from the derived data, so
 * only relationship-fact connections can ever appear.
 */

interface CharacterNodeData extends Record<string, unknown> {
  readonly name: string;
  readonly importance: number;
  readonly role: GraphNode["role"];
  readonly isRoot: boolean;
}

type CharacterFlowNode = Node<CharacterNodeData, "character">;

/** One badge rendering per role; the root's focus mark never replaces the role. */
function roleBadge(role: CharacterNodeData["role"]): { label: string; className: string } {
  if (role === "protagonist") {
    return { label: "protagonist", className: "bg-amber-900/60 text-amber-200" };
  }
  return { label: "supporting", className: "bg-zinc-800 text-zinc-400" };
}

const INITIAL_ROOT_ZOOM = 1;
const REFOCUS_DURATION_MS = 400;

function CharacterNode({ data }: NodeProps<CharacterFlowNode>) {
  const badge = roleBadge(data.role);
  return (
    <div
      className={`h-full w-full rounded-lg border p-3 shadow-md transition-colors ${
        data.isRoot
          ? "border-sky-500 bg-zinc-900"
          : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-zinc-600" />
      <div className="flex items-start justify-between gap-2">
        <span className="truncate font-medium text-zinc-100" title={data.name}>
          {data.name}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {data.isRoot ? <span className="text-sky-300">root · </span> : null}
        {data.importance} mention{data.importance === 1 ? "" : "s"}
      </p>
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-600" />
    </div>
  );
}

const nodeTypes: NodeTypes = { character: CharacterNode };

function flowNodes(
  graph: GraphData,
  root: string | null,
): CharacterFlowNode[] {
  return layoutGraph(graph, root).map((viewNode) => ({
    id: viewNode.name,
    type: "character",
    position: { x: viewNode.x, y: viewNode.y },
    data: {
      name: viewNode.name,
      importance: viewNode.importance,
      role: viewNode.role,
      isRoot: viewNode.name === root,
    },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));
}

/**
 * One edge per relationship fact, labelled with its relation; parallel facts
 * between the same pair fan out with distinct curvature so every fact stays
 * readable. Facts pass through 1:1 — nothing added, nothing merged away.
 */
function flowEdges(graph: GraphData): BuiltInEdge[] {
  const seenPairs = new Map<string, number>();
  return graph.edges.map((edge, index) => {
    const pair = [edge.from, edge.to].sort().join("↔");
    const parallelIndex = seenPairs.get(pair) ?? 0;
    seenPairs.set(pair, parallelIndex + 1);
    return {
      id: `fact-${index}`,
      source: edge.from,
      target: edge.to,
      type: "default",
      pathOptions: { curvature: 0.25 + parallelIndex * 0.3 },
      label: edge.relation,
      labelStyle: { fill: "#a1a1aa", fontSize: 10 },
      labelBgStyle: { fill: "#18181b" },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      style: { stroke: "#52525b" },
    };
  });
}

/** Keeps the active root centered: exact framing on mount, a gentle glide on re-root. */
function ViewportFocus({ root }: { root: string | null }) {
  const { setCenter, getZoom } = useReactFlow();
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      setCenter(0, 0, { zoom: INITIAL_ROOT_ZOOM });
      return;
    }
    setCenter(0, 0, { zoom: getZoom(), duration: REFOCUS_DURATION_MS });
  }, [root, setCenter, getZoom]);
  return null;
}

export function RelationshipGraph({
  graph,
  profiles,
}: {
  graph: GraphData;
  profiles: readonly CharacterProfile[];
}) {
  const [requestedRoot, setRequestedRoot] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);

  const root = useMemo(() => resolveRoot(graph, requestedRoot), [graph, requestedRoot]);
  const nodes = useMemo(() => flowNodes(graph, root), [graph, root]);
  const edges = useMemo(() => flowEdges(graph), [graph]);

  // The full-profile side panel reuses the Characters section's detail
  // drawer: one profile rendering, two entry points into it.
  const cards: readonly CharacterCard[] = useMemo(
    () => orderCharacters(profiles, graph),
    [profiles, graph],
  );
  const selectedCard = cards.find((card) => card.profile.name === profileName);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: CharacterFlowNode) => {
      setRequestedRoot(node.data.name);
      setProfileName(node.data.name);
    },
    [],
  );

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 sm:col-span-2">
      <h4 className="mb-2 flex items-center justify-between text-sm font-semibold text-zinc-200">
        Relationship graph
        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
          {graph.nodes.length} nodes · {graph.edges.length} edges
        </span>
      </h4>
      {graph.nodes.length === 0 ? (
        <p className="text-sm text-zinc-600">none yet</p>
      ) : (
        <div className="relative h-96 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={onNodeClick}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              minZoom={0.2}
              maxZoom={1.5}
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#3f3f46" />
              <Controls showInteractive={false} />
              <ViewportFocus root={root} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      )}
      {selectedCard !== undefined && (
        <CharacterDetail card={selectedCard} onClose={() => setProfileName(null)} />
      )}
    </section>
  );
}
