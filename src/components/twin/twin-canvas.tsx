"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from "@xyflow/react";
import { consumptionPerHour } from "@/domain/kpis";
import type { FactoryState } from "@/domain/types";
import { useFactory, useUi, type Highlight } from "@/client/store";
import { buildGraph, type MachineData } from "./graph";
import { nodeTypes } from "./nodes";import { STATUS_COLOR } from "../ui/labels";


export interface TwinCanvasProps {
  state: FactoryState;
  highlight: Highlight | null;
  interactive?: boolean;
  connectMode?: boolean;
  focusAssetId?: string | null;
  orderRisk?: Record<string, boolean>;
  onSelectNode?: (id: string | null) => void;
  selectedId?: string | null;
  className?: string;
  minimap?: boolean;
}

const NO_RISK: Record<string, boolean> = {};
const PREVIEW_LAYERS = { sensors: false, inventory: true, orders: true, cameras: false };
const NO_POSITIONS: Record<string, { x: number; y: number }> = {};

function Canvas({ state, highlight, interactive = true, connectMode = false, focusAssetId, orderRisk = NO_RISK, onSelectNode, selectedId, minimap = true }: TwinCanvasProps) {
  const layers = useUi((s) => s.layers);
  const positions = useUi((s) => s.nodePositions);
  const setNodePosition = useUi((s) => s.setNodePosition);
  const connect = useFactory((s) => s.connect);
  const { fitView, setCenter, getInternalNode } = useReactFlow();

  const coverage = useMemo(() => {
    const out: Record<string, number> = {};
    for (const i of state.inventory) {
      const r = consumptionPerHour(state, i.id);
      out[i.id] = r > 0 ? i.onHand / r : Infinity;
    }
    return out;
  }, [state]);

  const built = useMemo(
    () => buildGraph(state, { layers: interactive ? layers : PREVIEW_LAYERS, highlight, positions: interactive ? positions : NO_POSITIONS, interactive, orderRisk, coverage }),
    [state, layers, highlight, positions, interactive, orderRisk, coverage],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(built.nodes);
  const edges: Edge[] = built.edges;

  // Merge freshly built nodes (live data) with React Flow's measured dimensions & selection.
  useEffect(() => {
    setNodes((prev) => {
      const pm = new Map(prev.map((n) => [n.id, n]));
      return built.nodes.map((n) => {
        const p = pm.get(n.id);
        return p ? { ...n, measured: p.measured, selected: n.id === selectedId } : { ...n, selected: n.id === selectedId };
      });
    });
  }, [built, selectedId, setNodes]);

  const layoutKey = `${layers.sensors}-${layers.inventory}-${layers.orders}-${layers.cameras}-${state.assets.length}-${Object.keys(positions).length === 0}`;
  const lastLayout = useRef<string>("");
  useEffect(() => {
    if (lastLayout.current === layoutKey) return;
    lastLayout.current = layoutKey;
    const t = setTimeout(() => fitView({ padding: 0.08, duration: 400 }), 60);
    return () => clearTimeout(t);
  }, [layoutKey, fitView]);

  // Center on an asset requested via URL / selection from another page.
  useEffect(() => {
    if (!focusAssetId) return;
    const t = setTimeout(() => {
      const n = getInternalNode(focusAssetId);
      if (n) setCenter(n.internals.positionAbsolute.x + 94, n.internals.positionAbsolute.y + 48, { zoom: 1.05, duration: 600 });
    }, 250);
    return () => clearTimeout(t);
  }, [focusAssetId, getInternalNode, setCenter]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_e, node) => {
      if (node.type === "line" || node.type === "sensor") return;
      onSelectNode?.(node.id);
    },
    [onSelectNode],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!connectMode || !c.source || !c.target) return;
      void connect(c.source, c.target);
    },
    [connect, connectMode],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={interactive ? onNodesChange : undefined}
      onNodeDragStop={(_e, node) => setNodePosition(node.id, node.position)}
      onNodeClick={onNodeClick}
      onPaneClick={() => onSelectNode?.(null)}
      onConnect={onConnect}
      nodesConnectable={connectMode}
      nodesDraggable={interactive}
      elementsSelectable={interactive}
      fitView
      fitViewOptions={{ padding: 0.08 }}
      minZoom={0.25}
      maxZoom={2}
      panOnScroll={false}
      zoomOnScroll={interactive}
      preventScrolling={interactive}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--color-surface-3)" />
      {interactive && <Controls showInteractive={false} position="bottom-left" />}
      {interactive && minimap && (
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          style={{ width: 150, height: 96 }}
          nodeColor={(n) => {
            if (n.type === "machine") {
              const s = (n.data as MachineData).asset.status;
              return STATUS_COLOR[s];
            }
            return n.type === "line" ? "var(--color-surface-2)" : "var(--color-line-strong)";
          }}
          maskColor="var(--minimap-mask)"
        />
      )}
    </ReactFlow>
  );
}

export function TwinCanvas(props: TwinCanvasProps) {
  return (
    <div className={props.className ?? "h-full w-full"}>
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
