"use client";

import type { FileGraph } from "@archmind/contracts";
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { useCallback, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { fetchFileGraph } from "./api";
import { LoadContent } from "./detail-content";
import { componentLabels } from "./labels";
import type { ThemePreference } from "./theme";

export function FileDrilldown({
  id,
  component,
  name,
  projection,
  theme,
  onBack
}: {
  id: string;
  component: string;
  name: string;
  projection: string;
  theme: ThemePreference;
  onBack: () => void;
}) {
  const load = useCallback(
    (signal: AbortSignal) => fetchFileGraph(id, component, projection, signal),
    [id, component, projection]
  );

  return (
    <section aria-label="File graph" className="min-w-0 space-y-3">
      <Button
        variant="outline"
        onClick={onBack}
        ref={(node) => {
          node?.focus();
        }}
      >
        Back to component graph
      </Button>
      <h2 className="font-semibold">File graph: {name}</h2>
      <LoadContent load={load}>
        {(graph) => <FileNetwork graph={graph} theme={theme} />}
      </LoadContent>
    </section>
  );
}

function FileNetwork({ graph, theme }: { graph: FileGraph; theme: ThemePreference }) {
  const { nodes, edges, labels } = useMemo(() => {
    const componentNames = componentLabels(graph.components);
    const labels = new Map<string, string>([
      ...graph.files.map((file) => [`file:${file.id}`, file.path] as const),
      ...graph.components.map(
        (component) =>
          [`component:${component.id}`, componentNames.get(component.id) ?? component.name] as const
      )
    ]);
    const columns = Math.max(1, Math.ceil(Math.sqrt(labels.size)));
    const nodes: Node[] = Array.from(labels, ([id, label], index) => ({
      id,
      data: { label },
      position: { x: (index % columns) * 295, y: Math.floor(index / columns) * 90 },
      ...(id.startsWith("component:") ? { className: "package-node" } : {}),
      style: { width: 265, overflowWrap: "anywhere", minHeight: 54 }
    }));
    const edges: Edge[] = graph.imports.map((item, index) => ({
      id: String(index),
      source: `file:${item.fromFileId}`,
      target:
        item.target.kind === "file"
          ? `file:${item.target.fileId}`
          : `component:${item.target.componentId}`,
      markerEnd: { type: MarkerType.ArrowClosed }
    }));
    return { nodes, edges, labels };
  }, [graph]);

  if (!nodes.length) return <p>No files in this component.</p>;
  return (
    <>
      <div className="h-[65dvh] min-h-96 overflow-hidden rounded-xl border">
        <ReactFlow
          aria-label="File dependency diagram"
          nodes={nodes}
          edges={edges}
          colorMode={theme}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          minZoom={0.05}
        >
          <Background gap={20} color="var(--color-border)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <details>
        <summary className="cursor-pointer">File graph list</summary>
        <ul className="space-y-2 py-2 text-sm">
          {graph.files.map((file) => (
            <li key={file.id}>{file.path}</li>
          ))}
        </ul>
        {edges.length === 0 ? (
          <p>No imports in this projection.</p>
        ) : (
          <ul aria-label="File imports" className="space-y-2 text-sm">
            {edges.map((edge, index) => (
              <li key={edge.id}>
                {labels.get(edge.source)}:{graph.imports[index]?.line} &rarr;{" "}
                {labels.get(edge.target)} ({graph.imports[index]?.kind})
              </li>
            ))}
          </ul>
        )}
      </details>
    </>
  );
}
