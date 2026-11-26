import type { ComponentGraph } from "@archmind/contracts";
import { MarkerType, type Edge } from "@xyflow/react";

import { componentLabels } from "./labels";

/** What the selected finding points at, so its edges can be drawn apart from the rest. */
export interface FindingEmphasis {
  readonly components: readonly string[];
  readonly edge?: readonly [from: string, to: string];
  readonly external?: readonly [componentId: string, packageName: string];
}

export function graphEdges(graph: ComponentGraph, emphasis?: FindingEmphasis): Edge[] {
  const emphasized = new Set(emphasis?.components);
  const reported = (source: string, target: string) =>
    emphasis?.edge
      ? emphasis.edge[0] === source && emphasis.edge[1] === target
      : emphasis?.external === undefined &&
        emphasized.size > 1 &&
        emphasized.has(source) &&
        emphasized.has(target);
  const cycles = new Map(
    graph.cycles.flatMap((cycle) => cycle.memberIds.map((id) => [id, cycle] as const))
  );
  const labels = componentLabels(graph.components);
  return [
    ...graph.dependencies.map(({ fromComponentId: source, toComponentId: target, weight }) => {
      const cycle = cycles.get(source);
      const tone =
        cycle && cycles.get(target) === cycle
          ? cycle.typeOnly
            ? "type-cycle"
            : "runtime-cycle"
          : "internal";
      const isReported = reported(source, target);
      return {
        id: JSON.stringify(["internal", source, target]),
        source,
        target,
        type: "straight",
        className: isReported ? `${tone} finding-edge` : tone,
        markerEnd: { type: MarkerType.ArrowClosed },
        ariaLabel: `${labels.get(source)} depends on ${labels.get(target)}; ${weight} imports${isReported ? "; reported by the selected finding" : ""}`
      };
    }),
    ...graph.externalDependencies.map(({ componentId: source, packageName, weight }) => {
      const isReported = emphasis?.external?.[0] === source && emphasis.external[1] === packageName;
      return {
        id: JSON.stringify(["external", source, packageName]),
        source,
        target: `external:${packageName}`,
        type: "straight",
        className: isReported ? "external finding-edge" : "external",
        markerEnd: { type: MarkerType.ArrowClosed },
        ariaLabel: `${labels.get(source)} depends on ${packageName}; ${weight} imports${isReported ? "; reported by the selected finding" : ""}`
      };
    })
  ];
}
