import type { ComponentGraph } from "@archmind/contracts";
import type { Node } from "@xyflow/react";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";

type Component = ComponentGraph["components"][number];
export type ComponentNode = Node<{ component: Component; grouped: boolean }, "component">;
export type PackageNode = Node<{ label: string }, "default">;
export type ExplorerNode = ComponentNode | PackageNode;

const width = 224;
const height = 68;
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
  const positioned = await elk.layout({
    id: "layout",
    layoutOptions: {
      "elk.algorithm": "box",
      "elk.spacing.nodeNode": "24",
      "elk.aspectRatio": "1.65"
    },
    children: [
      ...(children.get(undefined) ?? []).map(makeNode),
      ...packages.map((name) => ({ id: packageId(name), width, height }))
    ]
  });

  const byId = new Map(graph.components.map((component) => [component.id, component]));
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
        data: { component, grouped: Boolean(item.children?.length) }
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
  return nodes;
}
