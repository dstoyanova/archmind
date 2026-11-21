import type { ComponentGraph } from "@archmind/contracts";

type Labelled = Pick<ComponentGraph["components"][number], "id" | "name" | "paths">;

/** Names that repeat among the given components are qualified with their path, so labels stay unique. */
export function componentLabels(components: readonly Labelled[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const { name } of components) counts.set(name, (counts.get(name) ?? 0) + 1);
  return new Map(
    components.map(({ id, name, paths }) => [
      id,
      (counts.get(name) ?? 0) > 1 ? `${name} (${paths[0] ?? id})` : name
    ])
  );
}
