import type {
  ArchitectureSnapshotDocument
} from "@archmind/contracts";

type SnapshotComponent = ArchitectureSnapshotDocument["components"][number];
type SnapshotFile = ArchitectureSnapshotDocument["files"][number];
type SnapshotImport = ArchitectureSnapshotDocument["fileImports"][number];
type SnapshotDependency = ArchitectureSnapshotDocument["dependencies"][number];
type SnapshotExternalDependency = ArchitectureSnapshotDocument["externalDependencies"][number];
type SnapshotCycle = ArchitectureSnapshotDocument["cycles"][number];
type FileRole = SnapshotFile["role"];
type ImportKind = SnapshotImport["kind"];

export type GraphComponentInput = Omit<SnapshotComponent, "metrics">;

export interface BuildGraphMetricsAndCyclesInput {
  components: GraphComponentInput[];
  files: SnapshotFile[];
  fileImports: SnapshotImport[];
}

export interface BuildGraphMetricsAndCyclesResult {
  components: SnapshotComponent[];
  dependencies: SnapshotDependency[];
  externalDependencies: SnapshotExternalDependency[];
  cycles: SnapshotCycle[];
}

interface ComponentEdgeEvidence {
  importId: string;
  fromRole: FileRole;
  kind: ImportKind;
}

interface TarjanGraph {
  nodes: string[];
  edges: Array<{ from: string; to: string; typeOnly: boolean }>;
}

export function buildGraphMetricsAndCycles(
  input: BuildGraphMetricsAndCyclesInput
): BuildGraphMetricsAndCyclesResult {
  const components = [...input.components].sort(compareGraphComponentsById);
  const componentById = new Map(components.map((component) => [component.id, component] as const));
  const parentById = new Map(components.map((component) => [component.id, component.parentId] as const));
  const fileById = new Map(input.files.map((file) => [file.id, file] as const));
  const fileIdsByPath = new Map(input.files.map((file) => [file.path, file.id] as const));
  const childrenById = buildChildrenById(components);
  const ancestorByDepth = buildAncestorByDepth(components, parentById);

  const dependencyEvidenceByEdge = new Map<string, ComponentEdgeEvidence[]>();
  const productionComponentEdges: Array<{
    fromComponentId: string;
    toComponentId: string;
    importId: string;
    typeOnly: boolean;
  }> = [];
  const productionFileEdges: Array<{ fromFileId: string; toFileId: string; typeOnly: boolean }> = [];
  const externalDependencyEvidence = new Map<string, Map<FileRole, number>>();

  for (const fileImport of input.fileImports) {
    const fromFile = fileById.get(fileImport.fromFileId);
    if (!fromFile) {
      continue;
    }

    const toFileId = resolveImportToFileId(fileImport, fileIdsByPath);
    const toFile = toFileId ? fileById.get(toFileId) : undefined;
    const toComponentId = toFile?.componentId ?? fileImport.toComponentId;

    if (fileImport.externalPackage) {
      const externalKey = `${fromFile.componentId}→${fileImport.externalPackage}`;
      const countsByRole = externalDependencyEvidence.get(externalKey) ?? new Map<FileRole, number>();
      countsByRole.set(fromFile.role, (countsByRole.get(fromFile.role) ?? 0) + 1);
      externalDependencyEvidence.set(externalKey, countsByRole);
      continue;
    }

    if (!toComponentId || !componentById.has(toComponentId)) {
      continue;
    }

    if (toComponentId !== fromFile.componentId) {
      const dependencyKey = `${fromFile.componentId}→${toComponentId}`;
      const evidence = dependencyEvidenceByEdge.get(dependencyKey) ?? [];
      evidence.push({
        importId: fileImport.id,
        fromRole: fromFile.role,
        kind: fileImport.kind
      });
      dependencyEvidenceByEdge.set(dependencyKey, evidence);
    }

    const isProductionImport =
      fromFile.role === "source" && fileImport.resolution !== "external-package";

    if (!isProductionImport) {
      continue;
    }

    const isTypeOnly = fileImport.kind === "type-only";
    productionComponentEdges.push({
      fromComponentId: fromFile.componentId,
      toComponentId,
      importId: fileImport.id,
      typeOnly: isTypeOnly
    });

    if (toFile && toFile.role === "source") {
      productionFileEdges.push({
        fromFileId: fromFile.id,
        toFileId: toFile.id,
        typeOnly: isTypeOnly
      });
    }
  }

  const dependencies = [...dependencyEvidenceByEdge.entries()]
    .map(([key, evidence]) => {
      const [fromComponentId, toComponentId] = parseEdgeKey(key);
      const countsByKind: Partial<Record<ImportKind, number>> = {};
      const countsByRole: Partial<Record<FileRole, number>> = {};

      const evidenceImportIds = evidence.map((entry) => entry.importId).sort();
      for (const item of evidence) {
        countsByKind[item.kind] = (countsByKind[item.kind] ?? 0) + 1;
        countsByRole[item.fromRole] = (countsByRole[item.fromRole] ?? 0) + 1;
      }

      return {
        id: `dep:${fromComponentId}->${toComponentId}`,
        fromComponentId,
        toComponentId,
        weight: evidence.length,
        countsByKind,
        countsByRole,
        evidenceImportIds
      } satisfies SnapshotDependency;
    })
    .sort((left, right) => compareEdges(left.fromComponentId, left.toComponentId, right.fromComponentId, right.toComponentId));

  const externalDependencies = [...externalDependencyEvidence.entries()]
    .map(([key, countsByRoleMap]) => {
      const [componentId, packageName] = parseEdgeKey(key);
      const countsByRole: Partial<Record<FileRole, number>> = {};
      let weight = 0;
      for (const [role, count] of [...countsByRoleMap.entries()].sort((left, right) =>
        left[0].localeCompare(right[0])
      )) {
        countsByRole[role] = count;
        weight += count;
      }

      return {
        componentId,
        packageName,
        weight,
        countsByRole
      } satisfies SnapshotExternalDependency;
    })
    .sort((left, right) => compareEdges(left.componentId, left.packageName, right.componentId, right.packageName));

  const metricsByComponent = buildComponentMetrics(
    components,
    input.files,
    childrenById,
    ancestorByDepth,
    productionComponentEdges
  );

  const metricsComponents = components.map((component) => ({
    ...component,
    metrics: metricsByComponent.get(component.id) ?? {
      fileCount: 0,
      loc: 0,
      fanIn: 0,
      fanOut: 0,
      instability: 0
    }
  }));

  const cycles = [
    ...buildDepthCycles(components, ancestorByDepth, productionComponentEdges),
    ...buildFileCycles(input.files, productionFileEdges)
  ];

  return {
    components: metricsComponents,
    dependencies,
    externalDependencies,
    cycles
  };
}

function buildComponentMetrics(
  components: GraphComponentInput[],
  files: SnapshotFile[],
  childrenById: Map<string, string[]>,
  ancestorByDepth: Map<string, Map<number, string>>,
  productionComponentEdges: Array<{
    fromComponentId: string;
    toComponentId: string;
  }>
): Map<string, SnapshotComponent["metrics"]> {
  const fileCountByComponent = new Map<string, number>();
  const locByComponent = new Map<string, number>();

  for (const file of files) {
    increment(fileCountByComponent, file.componentId, 1);
    increment(locByComponent, file.componentId, file.loc);
  }

  const depths = [...new Set(components.map((component) => component.depth))].sort((a, b) => b - a);
  for (const depth of depths) {
    const nodesAtDepth = components.filter((component) => component.depth === depth);
    for (const node of nodesAtDepth) {
      const children = childrenById.get(node.id) ?? [];
      for (const childId of children) {
        increment(fileCountByComponent, node.id, fileCountByComponent.get(childId) ?? 0);
        increment(locByComponent, node.id, locByComponent.get(childId) ?? 0);
      }
    }
  }

  const metricsByComponent = new Map<string, SnapshotComponent["metrics"]>();
  for (const component of components) {
    const projectedEdges = projectEdgesAtDepth(component.depth, ancestorByDepth, productionComponentEdges);
    const outgoing = new Set<string>();
    const incoming = new Set<string>();

    for (const edge of projectedEdges) {
      if (edge.from === component.id) {
        outgoing.add(edge.to);
      }

      if (edge.to === component.id) {
        incoming.add(edge.from);
      }
    }

    const fanOut = outgoing.size;
    const fanIn = incoming.size;
    const total = fanIn + fanOut;
    metricsByComponent.set(component.id, {
      fileCount: fileCountByComponent.get(component.id) ?? 0,
      loc: locByComponent.get(component.id) ?? 0,
      fanIn,
      fanOut,
      instability: total === 0 ? 0 : fanOut / total
    });
  }

  return metricsByComponent;
}

function buildDepthCycles(
  components: GraphComponentInput[],
  ancestorByDepth: Map<string, Map<number, string>>,
  productionComponentEdges: Array<{
    fromComponentId: string;
    toComponentId: string;
    typeOnly: boolean;
  }>
): SnapshotCycle[] {
  const cycles: SnapshotCycle[] = [];
  const depths = [...new Set(components.map((component) => component.depth))].sort((a, b) => a - b);

  for (const depth of depths) {
    const nodes = components
      .filter((component) => component.depth <= depth)
      .map((component) => component.id)
      .sort();

    const fullEdges = projectEdgesAtDepth(depth, ancestorByDepth, productionComponentEdges, true);
    const runtimeEdges = fullEdges.filter((edge) => !edge.typeOnly);
    const graph: TarjanGraph = {
      nodes,
      edges: fullEdges.map((edge) => ({ from: edge.from, to: edge.to, typeOnly: edge.typeOnly }))
    };

    const stronglyConnected = findStronglyConnectedComponents(graph);
    for (const members of stronglyConnected) {
      const cycleMembers = [...members].sort();
      const typeOnly = !hasCycle({
        nodes: cycleMembers,
        edges: runtimeEdges
          .filter((edge) => cycleMembers.includes(edge.from) && cycleMembers.includes(edge.to))
          .map((edge) => ({ from: edge.from, to: edge.to, typeOnly: false }))
      });

      cycles.push({
        level: { kind: "depth", depth },
        memberIds: cycleMembers,
        typeOnly
      });
    }
  }

  return cycles.sort(compareCycles);
}

function buildFileCycles(
  files: SnapshotFile[],
  productionFileEdges: Array<{ fromFileId: string; toFileId: string; typeOnly: boolean }>
): SnapshotCycle[] {
  const sourceFileIds = files
    .filter((file) => file.role === "source")
    .map((file) => file.id)
    .sort();
  const graph: TarjanGraph = {
    nodes: sourceFileIds,
    edges: productionFileEdges.map((edge) => ({
      from: edge.fromFileId,
      to: edge.toFileId,
      typeOnly: edge.typeOnly
    }))
  };

  const cycles = findStronglyConnectedComponents(graph).map((members) => {
    const cycleMembers = [...members].sort();
    const runtimeEdges = graph.edges.filter(
      (edge) => !edge.typeOnly && cycleMembers.includes(edge.from) && cycleMembers.includes(edge.to)
    );
    const typeOnly = !hasCycle({
      nodes: cycleMembers,
      edges: runtimeEdges
    });

    return {
      level: { kind: "file" } as const,
      memberIds: cycleMembers,
      typeOnly
    } satisfies SnapshotCycle;
  });

  return cycles.sort(compareCycles);
}

function projectEdgesAtDepth(
  depth: number,
  ancestorByDepth: Map<string, Map<number, string>>,
  edges: Array<{
    fromComponentId: string;
    toComponentId: string;
    typeOnly?: boolean;
  }>,
  includeTypeOnlyMarker = false
): Array<{ from: string; to: string; typeOnly: boolean }> {
  const projected = new Map<string, { from: string; to: string; typeOnly: boolean }>();

  for (const edge of edges) {
    const from = ancestorByDepth.get(edge.fromComponentId)?.get(depth);
    const to = ancestorByDepth.get(edge.toComponentId)?.get(depth);
    if (!from || !to || from === to) {
      continue;
    }

    const key = `${from}→${to}`;
    const existing = projected.get(key);
    if (!existing) {
      projected.set(key, {
        from,
        to,
        typeOnly: includeTypeOnlyMarker ? edge.typeOnly === true : false
      });
      continue;
    }

    if (includeTypeOnlyMarker && edge.typeOnly !== true) {
      existing.typeOnly = false;
    }
  }

  return [...projected.values()].sort((left, right) =>
    compareEdges(left.from, left.to, right.from, right.to)
  );
}

function findStronglyConnectedComponents(graph: TarjanGraph): string[][] {
  const adjacency = buildAdjacency(graph.nodes, graph.edges.map((edge) => ({ from: edge.from, to: edge.to })));
  const indexByNode = new Map<string, number>();
  const lowLinkByNode = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const stronglyConnected: string[][] = [];
  let index = 0;

  const strongConnect = (node: string): void => {
    indexByNode.set(node, index);
    lowLinkByNode.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    const neighbors = adjacency.get(node) ?? [];
    for (const neighbor of neighbors) {
      if (!indexByNode.has(neighbor)) {
        strongConnect(neighbor);
        lowLinkByNode.set(
          node,
          Math.min(lowLinkByNode.get(node) ?? Number.POSITIVE_INFINITY, lowLinkByNode.get(neighbor) ?? Number.POSITIVE_INFINITY)
        );
        continue;
      }

      if (onStack.has(neighbor)) {
        lowLinkByNode.set(
          node,
          Math.min(lowLinkByNode.get(node) ?? Number.POSITIVE_INFINITY, indexByNode.get(neighbor) ?? Number.POSITIVE_INFINITY)
        );
      }
    }

    if (lowLinkByNode.get(node) !== indexByNode.get(node)) {
      return;
    }

    const component: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        break;
      }

      onStack.delete(current);
      component.push(current);
      if (current === node) {
        break;
      }
    }

    const componentSet = new Set(component);
    const isCycle =
      component.length > 1 ||
      component.some((member) =>
        (adjacency.get(member) ?? []).some((neighbor) => componentSet.has(neighbor))
      );

    if (isCycle) {
      stronglyConnected.push(component);
    }
  };

  for (const node of graph.nodes) {
    if (!indexByNode.has(node)) {
      strongConnect(node);
    }
  }

  return stronglyConnected;
}

function hasCycle(graph: TarjanGraph): boolean {
  return findStronglyConnectedComponents(graph).length > 0;
}

function buildAdjacency(
  nodes: string[],
  edges: Array<{ from: string; to: string }>
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>(
    nodes.map((node) => [node, [] as string[]])
  );
  for (const edge of edges) {
    const neighbors = adjacency.get(edge.from);
    if (!neighbors) {
      continue;
    }

    neighbors.push(edge.to);
  }

  for (const [node, neighbors] of adjacency.entries()) {
    adjacency.set(node, [...new Set(neighbors)].sort());
  }

  return adjacency;
}

function buildChildrenById(components: GraphComponentInput[]): Map<string, string[]> {
  const childrenById = new Map<string, string[]>();
  for (const component of components) {
    if (!component.parentId) {
      continue;
    }

    const children = childrenById.get(component.parentId) ?? [];
    children.push(component.id);
    childrenById.set(component.parentId, children);
  }

  for (const children of childrenById.values()) {
    children.sort();
  }

  return childrenById;
}

function buildAncestorByDepth(
  components: GraphComponentInput[],
  parentById: Map<string, string | undefined>
): Map<string, Map<number, string>> {
  const byDepth = new Map<string, Map<number, string>>();

  for (const component of components) {
    const mapping = new Map<number, string>();
    let currentId: string | undefined = component.id;
    let currentDepth = component.depth;

    while (currentId !== undefined) {
      mapping.set(currentDepth, currentId);

      currentId = parentById.get(currentId);
      if (currentId === undefined) {
        break;
      }

      currentDepth -= 1;
    }

    byDepth.set(component.id, mapping);
  }

  return byDepth;
}

function resolveImportToFileId(
  fileImport: SnapshotImport,
  fileIdsByPath: Map<string, string>
): string | undefined {
  if (fileImport.toFileId) {
    return fileImport.toFileId;
  }

  const resolvedPath = (fileImport as { resolvedFilePath?: string }).resolvedFilePath;
  if (!resolvedPath) {
    return undefined;
  }

  return fileIdsByPath.get(resolvedPath);
}

function increment(target: Map<string, number>, key: string, value: number): void {
  target.set(key, (target.get(key) ?? 0) + value);
}

function parseEdgeKey(key: string): [string, string] {
  const separatorIndex = key.indexOf("→");
  if (separatorIndex < 1 || separatorIndex >= key.length - 1) {
    throw new Error(`Invalid edge key: "${key}"`);
  }

  return [key.slice(0, separatorIndex), key.slice(separatorIndex + 1)];
}

function compareGraphComponentsById(
  left: GraphComponentInput,
  right: GraphComponentInput
): number {
  return left.id.localeCompare(right.id);
}

function compareEdges(
  leftFrom: string,
  leftTo: string,
  rightFrom: string,
  rightTo: string
): number {
  if (leftFrom !== rightFrom) {
    return leftFrom.localeCompare(rightFrom);
  }

  return leftTo.localeCompare(rightTo);
}

function compareCycles(left: SnapshotCycle, right: SnapshotCycle): number {
  if (left.level.kind !== right.level.kind) {
    return left.level.kind.localeCompare(right.level.kind);
  }

  if (left.level.kind === "depth" && right.level.kind === "depth" && left.level.depth !== right.level.depth) {
    return left.level.depth - right.level.depth;
  }

  return left.memberIds.join("|").localeCompare(right.memberIds.join("|"));
}
