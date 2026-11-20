"use client";

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type NodeProps
} from "@xyflow/react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { createContext, memo, useContext, useEffect, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ComponentNode, ExplorerNode } from "./layout";
import type { ThemePreference } from "./theme";

interface Interaction {
  expandable: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  cycles: ReadonlyMap<string, "type-cycle" | "runtime-cycle">;
  focused: string | null;
  toggle(id: string): void;
  select(id: string): void;
}

const InteractionContext = createContext<Interaction | null>(null);

const GraphComponent = memo(function GraphComponent({ id, data }: NodeProps<ComponentNode>) {
  const interaction = useContext(InteractionContext);
  const { component } = data;
  const expanded = interaction?.expanded.has(id) ?? false;
  const cycle = interaction?.cycles.get(id);
  return (
    <div
      data-testid="component-node"
      data-component-id={id}
      className={`graph-node ${cycle ?? ""} ${data.grouped ? "group-node" : ""} ${interaction?.focused === id ? "focused-node" : ""}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="flex items-start gap-2 p-2.5">
        <div className="min-w-0 flex-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="nodrag nopan h-auto max-w-full justify-start p-0 text-sm font-semibold"
            title={component.name}
            aria-label={`Details for ${component.name}`}
            onClick={() => interaction?.select(id)}
          >
            <span className="truncate">{component.name}</span>
          </Button>
          <div
            className="truncate text-xs text-muted-foreground"
            title={component.paths.join(", ")}
          >
            {component.paths[0] ?? component.kind}
          </div>
        </div>
        {cycle && (
          <Badge variant="outline" className="px-1 text-[9px]">
            {cycle === "type-cycle" ? "Type" : "Cycle"}
          </Badge>
        )}
        {interaction?.expandable.has(id) && component.depth >= 1 && (
          <Button
            type="button"
            className="nodrag nopan"
            variant="ghost"
            size="icon-sm"
            aria-label={`${expanded ? "Collapse" : "Expand"} ${component.name}`}
            aria-expanded={expanded}
            onClick={() => interaction.toggle(id)}
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </Button>
        )}
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

const nodeTypes = { component: GraphComponent };

function FitView({ nodes, focus }: { nodes: ExplorerNode[]; focus: string | null }) {
  const flow = useReactFlow<ExplorerNode>();
  useEffect(() => {
    const frame = globalThis.requestAnimationFrame(() => {
      void flow.fitView({
        padding: 0.15,
        ...(focus ? { nodes: [{ id: focus }], maxZoom: 1.2 } : {})
      });
    });
    return () => globalThis.cancelAnimationFrame(frame);
  }, [flow, nodes, focus]);
  return null;
}

export function GraphCanvas({
  nodes,
  edges,
  interaction,
  theme,
  children
}: {
  nodes: ExplorerNode[];
  edges: Edge[];
  interaction: Interaction;
  theme: ThemePreference;
  children?: ReactNode;
}) {
  return (
    <InteractionContext.Provider value={interaction}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        colorMode={theme}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.05}
        maxZoom={2}
        fitView
        aria-label="Architecture dependency graph"
      >
        <Background gap={20} color="var(--color-border)" />
        <Controls showInteractive={false} />
        <FitView nodes={nodes} focus={interaction.focused} />
        {children}
      </ReactFlow>
    </InteractionContext.Provider>
  );
}
