import {
  canonicalJson,
  findTypedCycles,
  findVisibleAncestor,
  type ProjectedGraph
} from "@archmind/domain";

interface CycleSupport {
  memberIds: string[];
  endpoints: [string, string][];
  imports: Set<string>;
}

export function collectCycleSupport(
  depths: readonly number[],
  graphAtDepth: (depth: number) => ProjectedGraph,
  parentById: ReadonlyMap<string, string | undefined>,
  options: { componentIds?: ReadonlySet<string> | undefined; includeTypeOnlyCycles: boolean }
): CycleSupport[] {
  const kept: CycleSupport[] = [];
  const results = new Map<string, CycleSupport>();

  for (const depth of depths) {
    const graph = graphAtDepth(depth);
    const inScope = (id: string) => options.componentIds?.has(id) ?? true;
    const nodes = graph.components.map((component) => component.id).filter(inScope);
    const dependencies = graph.dependencies.filter(
      (edge) => inScope(edge.fromComponentId) && inScope(edge.toComponentId)
    );
    const cycles = options.componentIds
      ? findTypedCycles({
          nodes,
          edges: dependencies.map((edge) => ({
            from: edge.fromComponentId,
            to: edge.toComponentId,
            typeOnly: edge.countsByKind["type-only"] === edge.weight
          }))
        })
      : graph.cycles;
    const candidates: CycleSupport[] = [];
    const byMember = new Map<string, CycleSupport>();
    for (const { memberIds, typeOnly } of cycles) {
      if (typeOnly && !options.includeTypeOnlyCycles) {
        continue;
      }
      const candidate: CycleSupport = { memberIds, endpoints: [], imports: new Set() };
      candidates.push(candidate);
      for (const id of memberIds) {
        byMember.set(id, candidate);
      }
    }
    for (const { fromComponentId, toComponentId, evidenceImportIds } of dependencies) {
      const candidate = byMember.get(fromComponentId);
      if (candidate && candidate === byMember.get(toComponentId)) {
        candidate.endpoints.push([fromComponentId, toComponentId]);
        for (const id of evidenceImportIds) {
          candidate.imports.add(id);
        }
      }
    }

    const deeperByMember = new Map<string, CycleSupport[]>();
    const visible = new Set(nodes);
    for (const deeper of kept) {
      const projected = new Set(
        deeper.memberIds.map((id) => findVisibleAncestor(id, parentById, visible))
      );
      const anchor = projected.values().next().value;
      if (anchor === undefined) {
        continue;
      }
      const candidate = byMember.get(anchor);
      if (
        candidate &&
        projected.size === candidate.memberIds.length &&
        candidate.memberIds.every((id) => projected.has(id))
      ) {
        const covering = deeperByMember.get(anchor) ?? [];
        covering.push(deeper);
        deeperByMember.set(anchor, covering);
      }
    }

    for (const candidate of candidates) {
      const covering = candidate.memberIds.flatMap((id) => deeperByMember.get(id) ?? []);
      if (
        covering.some(
          (deeper) =>
            deeper.imports.size >= candidate.imports.size &&
            [...candidate.imports].every((id) => deeper.imports.has(id))
        )
      ) {
        continue;
      }
      kept.push(candidate);
      const key = canonicalJson([candidate.memberIds, candidate.endpoints]);
      const existing = results.get(key);
      if (existing) {
        // Distinct support at two depths can still describe the same projected subject.
        for (const id of candidate.imports) {
          existing.imports.add(id);
        }
      } else {
        results.set(key, { ...candidate, imports: new Set(candidate.imports) });
      }
    }
  }

  return [...results.values()];
}
