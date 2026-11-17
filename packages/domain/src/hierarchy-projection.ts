import { compareStrings } from "./ordering.js";

export interface HierarchyNode {
  id: string;
  parentId?: string | undefined;
  depth: number;
}

export interface HierarchyEdge {
  fromComponentId: string;
  toComponentId: string;
  typeOnly?: boolean | undefined;
}

export interface ProjectedHierarchyEdge {
  from: string;
  to: string;
  /** True only when every underlying edge is type-only. */
  typeOnly: boolean;
}

/**
 * Components shown at a level of detail: everything at or above `depth`, plus
 * the children of every explicitly expanded component.
 */
export function collectVisibleComponentIds(
  components: readonly HierarchyNode[],
  depth: number,
  expanded: ReadonlySet<string> = new Set()
): Set<string> {
  const visible = new Set(
    components.filter((component) => component.depth <= depth).map((component) => component.id)
  );

  let changed = true;
  while (changed) {
    changed = false;

    for (const component of components) {
      if (!component.parentId || visible.has(component.id) || !visible.has(component.parentId)) {
        continue;
      }

      if (expanded.has(component.parentId)) {
        visible.add(component.id);
        changed = true;
      }
    }
  }

  return visible;
}

/** The component itself when visible, otherwise its nearest visible ancestor. */
export function findVisibleAncestor(
  componentId: string,
  parentById: ReadonlyMap<string, string | undefined>,
  visibleComponentIds: ReadonlySet<string>
): string | undefined {
  let currentId: string | undefined = componentId;
  while (currentId !== undefined) {
    if (visibleComponentIds.has(currentId)) {
      return currentId;
    }

    currentId = parentById.get(currentId);
  }

  return undefined;
}

/**
 * Projects component edges onto the components visible at `depth`. Each endpoint
 * maps to its nearest visible ancestor, so edges from files owned directly by a
 * parent (for example a package barrel) stay attached to that parent. Edges
 * inside a single visible node are dropped.
 */
export function projectEdgesToDepth(
  components: readonly HierarchyNode[],
  edges: readonly HierarchyEdge[],
  depth: number
): ProjectedHierarchyEdge[] {
  const parentById = new Map(components.map((component) => [component.id, component.parentId] as const));
  const visible = collectVisibleComponentIds(components, depth);
  const projected = new Map<string, ProjectedHierarchyEdge>();

  for (const edge of edges) {
    const from = findVisibleAncestor(edge.fromComponentId, parentById, visible);
    const to = findVisibleAncestor(edge.toComponentId, parentById, visible);
    if (from === undefined || to === undefined || from === to) {
      continue;
    }

    const key = `${from}→${to}`;
    const existing = projected.get(key);
    if (!existing) {
      projected.set(key, { from, to, typeOnly: edge.typeOnly === true });
    } else if (edge.typeOnly !== true) {
      existing.typeOnly = false;
    }
  }

  return [...projected.values()].sort(
    (left, right) => compareStrings(left.from, right.from) || compareStrings(left.to, right.to)
  );
}
