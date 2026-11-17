import type { ArchitectureSnapshotDocument } from "@archmind/contracts";
import {
  compareStrings,
  findCycles,
  projectEdgesToDepth,
  type ProjectedHierarchyEdge
} from "@archmind/domain";

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

interface ProductionComponentEdge {
  fromComponentId: string;
  toComponentId: string;
  importId: string;
  typeOnly: boolean;
}

interface FileEdge {
  from: string;
  to: string;
  typeOnly: boolean;
}

export function buildGraphMetricsAndCycles(
  input: BuildGraphMetricsAndCyclesInput
): BuildGraphMetricsAndCyclesResult {
  const components = [...input.components].sort(compareGraphComponentsById);
  const componentById = new Map(components.map((component) => [component.id, component] as const));
  const fileById = new Map(input.files.map((file) => [file.id, file] as const));
  const childrenById = buildChildrenById(components);

  const dependencyEvidenceByEdge = new Map<string, ComponentEdgeEvidence[]>();
  const productionComponentEdges: ProductionComponentEdge[] = [];
  const productionFileEdges: FileEdge[] = [];
  const externalDependencyEvidence = new Map<string, Map<FileRole, number>>();

  for (const fileImport of input.fileImports) {
    const fromFile = fileById.get(fileImport.fromFileId);
    if (!fromFile) {
      continue;
    }

    const toFile = fileImport.toFileId ? fileById.get(fileImport.toFileId) : undefined;
    const toComponentId = toFile?.componentId ?? fileImport.toComponentId;

    if (fileImport.externalPackage) {
      const externalKey = `${fromFile.componentId}→${fileImport.externalPackage}`;
      const countsByRole =
        externalDependencyEvidence.get(externalKey) ?? new Map<FileRole, number>();
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
        from: fromFile.id,
        to: toFile.id,
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
    .sort((left, right) =>
      compareEdges(
        left.fromComponentId,
        left.toComponentId,
        right.fromComponentId,
        right.toComponentId
      )
    );

  const externalDependencies = [...externalDependencyEvidence.entries()]
    .map(([key, countsByRoleMap]) => {
      const [componentId, packageName] = parseEdgeKey(key);
      const countsByRole: Partial<Record<FileRole, number>> = {};
      let weight = 0;
      for (const [role, count] of [...countsByRoleMap.entries()].sort((left, right) =>
        compareStrings(left[0], right[0])
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
    .sort((left, right) =>
      compareEdges(left.componentId, left.packageName, right.componentId, right.packageName)
    );

  const metricsByComponent = buildComponentMetrics(
    components,
    input.files,
    childrenById,
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
    ...buildDepthCycles(components, productionComponentEdges),
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
  productionComponentEdges: ProductionComponentEdge[]
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

  const projectedEdgesByDepth = new Map<number, ProjectedHierarchyEdge[]>();
  const metricsByComponent = new Map<string, SnapshotComponent["metrics"]>();
  for (const component of components) {
    let projectedEdges = projectedEdgesByDepth.get(component.depth);
    if (!projectedEdges) {
      projectedEdges = projectEdgesToDepth(components, productionComponentEdges, component.depth);
      projectedEdgesByDepth.set(component.depth, projectedEdges);
    }

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
  productionComponentEdges: ProductionComponentEdge[]
): SnapshotCycle[] {
  const cycles: SnapshotCycle[] = [];
  const depths = [...new Set(components.map((component) => component.depth))].sort((a, b) => a - b);

  for (const depth of depths) {
    const nodes = components
      .filter((component) => component.depth <= depth)
      .map((component) => component.id)
      .sort(compareStrings);
    const edges = projectEdgesToDepth(components, productionComponentEdges, depth);

    for (const members of findCycles({ nodes, edges })) {
      cycles.push({
        level: { kind: "depth", depth },
        memberIds: members,
        typeOnly: !hasRuntimeCycle(members, edges)
      });
    }
  }

  return cycles.sort(compareCycles);
}

function buildFileCycles(files: SnapshotFile[], fileEdges: FileEdge[]): SnapshotCycle[] {
  const nodes = files
    .filter((file) => file.role === "source")
    .map((file) => file.id)
    .sort(compareStrings);

  return findCycles({ nodes, edges: fileEdges })
    .map(
      (members) =>
        ({
          level: { kind: "file" },
          memberIds: members,
          typeOnly: !hasRuntimeCycle(members, fileEdges)
        }) satisfies SnapshotCycle
    )
    .sort(compareCycles);
}

/** A cycle is runtime when its members still form a cycle using only non-type-only edges. */
function hasRuntimeCycle(
  members: readonly string[],
  edges: ReadonlyArray<{ from: string; to: string; typeOnly: boolean }>
): boolean {
  const memberSet = new Set(members);
  const runtimeEdges = edges.filter(
    (edge) => !edge.typeOnly && memberSet.has(edge.from) && memberSet.has(edge.to)
  );

  return findCycles({ nodes: members, edges: runtimeEdges }).length > 0;
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

function compareGraphComponentsById(left: GraphComponentInput, right: GraphComponentInput): number {
  return compareStrings(left.id, right.id);
}

function compareEdges(
  leftFrom: string,
  leftTo: string,
  rightFrom: string,
  rightTo: string
): number {
  if (leftFrom !== rightFrom) {
    return compareStrings(leftFrom, rightFrom);
  }

  return compareStrings(leftTo, rightTo);
}

function compareCycles(left: SnapshotCycle, right: SnapshotCycle): number {
  if (left.level.kind !== right.level.kind) {
    return compareStrings(left.level.kind, right.level.kind);
  }

  if (
    left.level.kind === "depth" &&
    right.level.kind === "depth" &&
    left.level.depth !== right.level.depth
  ) {
    return left.level.depth - right.level.depth;
  }

  return compareStrings(left.memberIds.join("|"), right.memberIds.join("|"));
}
