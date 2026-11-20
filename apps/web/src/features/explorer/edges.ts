import type { ComponentGraph } from "@archmind/contracts";
import { MarkerType, type Edge } from "@xyflow/react";

export function graphEdges(graph: ComponentGraph): Edge[] {
  const cycles = new Map(
    graph.cycles.flatMap((cycle) => cycle.memberIds.map((id) => [id, cycle] as const))
  );
  const names = new Map(graph.components.map(({ id, name }) => [id, name]));
  return [
    ...graph.dependencies.map(({ fromComponentId: source, toComponentId: target, weight }) => {
      const cycle = cycles.get(source);
      const tone =
        cycle && cycles.get(target) === cycle
          ? cycle.typeOnly
            ? "type-cycle"
            : "runtime-cycle"
          : "internal";
      return {
        id: JSON.stringify(["internal", source, target]),
        source,
        target,
        type: "straight",
        className: tone,
        markerEnd: { type: MarkerType.ArrowClosed },
        ariaLabel: `${names.get(source)} depends on ${names.get(target)}; ${weight} imports`
      };
    }),
    ...graph.externalDependencies.map(({ componentId: source, packageName, weight }) => ({
      id: JSON.stringify(["external", source, packageName]),
      source,
      target: `external:${packageName}`,
      type: "straight",
      className: "external",
      markerEnd: { type: MarkerType.ArrowClosed },
      ariaLabel: `${names.get(source)} depends on ${packageName}; ${weight} imports`
    }))
  ];
}
