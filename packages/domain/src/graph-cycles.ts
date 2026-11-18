import { compareStrings } from "./ordering.js";

export interface DirectedEdge {
  from: string;
  to: string;
}

export interface DirectedGraph {
  nodes: readonly string[];
  edges: readonly DirectedEdge[];
}

export interface TypedDirectedEdge extends DirectedEdge {
  typeOnly: boolean;
}

export interface GraphCycle {
  memberIds: string[];
  typeOnly: boolean;
}

/** A cycle is type-only if none of its members still participate in a runtime cycle. */
export function findTypedCycles(graph: {
  nodes: readonly string[];
  edges: readonly TypedDirectedEdge[];
}): GraphCycle[] {
  const cycles = findCycles(graph);
  if (cycles.length === 0) {
    return [];
  }

  const runtimeEdges = graph.edges.filter((edge) => !edge.typeOnly);
  if (runtimeEdges.length === graph.edges.length) {
    return cycles.map((memberIds) => ({ memberIds, typeOnly: false }));
  }

  const runtimeMembers = new Set(findCycles({ nodes: graph.nodes, edges: runtimeEdges }).flat());
  return cycles.map((memberIds) => ({
    memberIds,
    typeOnly: !memberIds.some((id) => runtimeMembers.has(id))
  }));
}

/**
 * Returns the strongly connected components that contain a cycle: components
 * with more than one member, or a single member with a self-loop. Members are
 * sorted, and the components are ordered by their sorted members.
 *
 * Tarjan's algorithm, iterative so that deep dependency chains cannot overflow
 * the call stack.
 */
export function findCycles(graph: DirectedGraph): string[][] {
  const adjacency = buildAdjacency(graph);
  const indexByNode = new Map<string, number>();
  const lowLinkByNode = new Map<string, number>();
  const onStack = new Set<string>();
  const componentStack: string[] = [];
  const cycles: string[][] = [];
  let nextIndex = 0;

  for (const root of graph.nodes) {
    if (indexByNode.has(root)) {
      continue;
    }

    const callStack: Array<{ node: string; neighborPosition: number }> = [];
    const enter = (node: string): void => {
      indexByNode.set(node, nextIndex);
      lowLinkByNode.set(node, nextIndex);
      nextIndex += 1;
      componentStack.push(node);
      onStack.add(node);
      callStack.push({ node, neighborPosition: 0 });
    };

    enter(root);
    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1];
      if (!frame) {
        break;
      }

      const neighbors = adjacency.get(frame.node) ?? [];
      const neighbor = neighbors[frame.neighborPosition];
      if (neighbor !== undefined) {
        frame.neighborPosition += 1;
        if (!indexByNode.has(neighbor)) {
          enter(neighbor);
        } else if (onStack.has(neighbor)) {
          lowLinkByNode.set(
            frame.node,
            Math.min(lowLinkByNode.get(frame.node) ?? 0, indexByNode.get(neighbor) ?? 0)
          );
        }
        continue;
      }

      callStack.pop();
      const parentFrame = callStack[callStack.length - 1];
      if (parentFrame) {
        lowLinkByNode.set(
          parentFrame.node,
          Math.min(lowLinkByNode.get(parentFrame.node) ?? 0, lowLinkByNode.get(frame.node) ?? 0)
        );
      }

      if (lowLinkByNode.get(frame.node) !== indexByNode.get(frame.node)) {
        continue;
      }

      const members: string[] = [];
      for (let member = componentStack.pop(); member !== undefined; member = componentStack.pop()) {
        onStack.delete(member);
        members.push(member);
        if (member === frame.node) {
          break;
        }
      }

      const memberSet = new Set(members);
      const containsCycle =
        members.length > 1 ||
        members.some((member) => (adjacency.get(member) ?? []).some((next) => memberSet.has(next)));
      if (containsCycle) {
        cycles.push(members.sort(compareStrings));
      }
    }
  }

  return cycles.sort((left, right) => compareStrings(left.join("|"), right.join("|")));
}

function buildAdjacency(graph: DirectedGraph): Map<string, string[]> {
  const adjacency = new Map<string, Set<string>>(
    graph.nodes.map((node) => [node, new Set<string>()])
  );
  for (const edge of graph.edges) {
    if (adjacency.has(edge.to)) {
      adjacency.get(edge.from)?.add(edge.to);
    }
  }

  return new Map(
    [...adjacency.entries()].map(([node, neighbors]) => [node, [...neighbors].sort(compareStrings)])
  );
}
