import type { ComponentGraph } from "@archmind/contracts";
import type { Node } from "@xyflow/react";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";

import { componentLabels } from "./labels";

type Component = ComponentGraph["components"][number];
export type ComponentNode = Node<
  { component: Component; label: string; grouped: boolean },
  "component"
>;
export type PackageNode = Node<{ label: string }, "default">;
export type ExplorerNode = ComponentNode | PackageNode;

const width = 224;
const height = 68;
// Layered layout cost grows steeply with edge count (about 260 ms at 600 edges, over 7 s at 3,000).
// Larger graphs use the box packing, which ignores edges.
const LAYERED_EDGE_LIMIT = 500;
const elk = new ELK();

export async function layoutGraph(graph: ComponentGraph): Promise<ExplorerNode[]> {
  const children = new Map<string | undefined, Component[]>();
  const visible = new Set(graph.components.map(({ id }) => id));
  for (const component of graph.components) {
    const parent =
      component.parentId && visible.has(component.parentId) ? component.parentId : undefined;
    const siblings = children.get(parent) ?? [];
    siblings.push(component);
    children.set(parent, siblings);
  }

  function makeNode(component: Component): ElkNode {
    const nested = children.get(component.id);
    return nested?.length
      ? {
          id: component.id,
          layoutOptions: { "elk.padding": "[top=84,left=20,bottom=20,right=20]" },
          children: nested.map(makeNode)
        }
      : { id: component.id, width, height };
  }

  const packages = [...new Set(graph.externalDependencies.map(({ packageName }) => packageName))];
  const packageId = (name: string) => `external:${name}`;
  const edges = graph.dependencies.map(({ fromComponentId, toComponentId }, index) => ({
    id: `edge-${index}`,
    sources: [fromComponentId],
    targets: [toComponentId]
  }));
  // External packages only receive edges, so they are gridded beside the layout instead of
  // being stacked in one column by the layered algorithm.
  const layered = edges.length + graph.externalDependencies.length <= LAYERED_EDGE_LIMIT;
  const positioned = await elk.layout({
    id: "layout",
    layoutOptions: layered
      ? {
          "elk.algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.hierarchyHandling": "INCLUDE_CHILDREN",
          "elk.spacing.nodeNode": "24",
          "elk.layered.spacing.nodeNodeBetweenLayers": "80"
        }
      : { "elk.algorithm": "box", "elk.spacing.nodeNode": "24", "elk.aspectRatio": "1.65" },
    edges: layered ? edges : [],
    children: [
      ...(children.get(undefined) ?? []).map(makeNode),
      ...(layered ? [] : packages.map((name) => ({ id: packageId(name), width, height })))
    ]
  });

  const byId = new Map(graph.components.map((component) => [component.id, component]));
  const labels = componentLabels(graph.components);
  const names = new Map(packages.map((name) => [packageId(name), name]));
  const nodes: ExplorerNode[] = [];
  function flatten(item: ElkNode, parentId?: string): void {
    const component = byId.get(item.id);
    const position = { x: item.x ?? 0, y: item.y ?? 0 };
    const size = { width: Math.max(item.width ?? width, width), height: item.height ?? height };
    if (component) {
      nodes.push({
        id: item.id,
        position,
        ...size,
        style: size,
        type: "component",
        ...(parentId ? { parentId } : {}),
        data: {
          component,
          label: labels.get(component.id) ?? component.name,
          grouped: Boolean(item.children?.length)
        }
      });
    } else {
      nodes.push({
        id: item.id,
        position,
        ...size,
        type: "default",
        style: size,
        className: "package-node",
        data: { label: names.get(item.id) ?? item.id }
      });
    }
    item.children?.forEach((child) => flatten(child, item.id));
  }
  positioned.children?.forEach((item) => flatten(item));
  if (layered) {
    placePackages(packages.map(packageId), positioned, names, nodes);
  }
  return nodes;
}

function placePackages(
  ids: string[],
  layout: ElkNode,
  names: ReadonlyMap<string, string>,
  nodes: ExplorerNode[]
): void {
  const columns = Math.max(1, Math.ceil(Math.sqrt(ids.length / 2)));
  const gap = 24;
  const rows = Math.ceil(ids.length / columns);
  const top = Math.max(0, ((layout.height ?? 0) - (rows * (height + gap) - gap)) / 2);
  ids.forEach((id, index) => {
    nodes.push({
      id,
      position: {
        x: (layout.width ?? 0) + 80 + (index % columns) * (width + gap),
        y: top + Math.floor(index / columns) * (height + gap)
      },
      width,
      height,
      style: { width, height },
      type: "default",
      className: "package-node",
      data: { label: names.get(id) ?? id }
    });
  });
}
