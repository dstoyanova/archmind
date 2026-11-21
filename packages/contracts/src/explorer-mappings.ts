import { compareStrings } from "@archmind/domain";
import type {
  ArchitectureComponent,
  ArchitectureFile,
  ArchitectureSnapshot,
  FileImport,
  ProjectedDependency,
  ProjectedFileGraph,
  ProjectedGraph,
  ProjectGraphOptions
} from "@archmind/domain";

import type {
  ComponentDetail,
  ComponentGraph,
  DependencyEvidence,
  DependencyEvidenceQuery,
  FileGraph,
  ProjectionQuery,
  SnapshotListItem,
  SnapshotOverview
} from "./explorer-schema.js";

export function toProjectGraphOptions(query: ProjectionQuery): ProjectGraphOptions {
  return {
    depth: query.depth,
    expanded: query.expand,
    filters: {
      includeFileRoles: query.roles,
      includeTypeOnly: query.includeTypeOnly,
      includeEmptyComponents: query.includeEmptyComponents
    }
  };
}

export interface SnapshotIdentity {
  readonly id: string;
  readonly label: string;
}

function snapshotMetadata(identity: SnapshotIdentity, snapshot: ArchitectureSnapshot) {
  return {
    id: identity.id,
    label: identity.label,
    contentHash: snapshot.contentHash,
    source: snapshot.source,
    createdAt: snapshot.createdAt
  };
}

export function toSnapshotListItem(
  identity: SnapshotIdentity,
  snapshot: ArchitectureSnapshot
): Extract<SnapshotListItem, { status: "ready" }> {
  return { ...snapshotMetadata(identity, snapshot), status: "ready" };
}

function countDiagnosticsByCode(snapshot: ArchitectureSnapshot): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { code } of snapshot.diagnostics) {
    counts[code] = (counts[code] ?? 0) + 1;
  }

  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => compareStrings(left, right))
  );
}

export function toSnapshotOverview(
  identity: SnapshotIdentity,
  snapshot: ArchitectureSnapshot
): SnapshotOverview {
  return {
    ...snapshotMetadata(identity, snapshot),
    schemaVersion: snapshot.schemaVersion,
    engineVersion: snapshot.engineVersion,
    parserVersion: snapshot.parserVersion,
    analysisConfigHash: snapshot.analysisConfigHash,
    resolutionStats: snapshot.resolutionStats,
    componentCount: snapshot.components.length,
    fileCount: snapshot.files.length,
    diagnosticCount: snapshot.diagnostics.length,
    diagnosticCountsByCode: countDiagnosticsByCode(snapshot)
  };
}

function toProjectedDependency(edge: ProjectedDependency): ComponentGraph["dependencies"][number] {
  return {
    fromComponentId: edge.fromComponentId,
    toComponentId: edge.toComponentId,
    weight: edge.weight,
    countsByKind: edge.countsByKind,
    countsByRole: edge.countsByRole
  };
}

export function toComponentGraph(graph: ProjectedGraph): ComponentGraph {
  return {
    level: "component",
    components: graph.components,
    dependencies: graph.dependencies.map(toProjectedDependency),
    externalDependencies: graph.externalDependencies,
    cycles: graph.cycles
  };
}

function importLocation({ line, column, specifier, kind }: Readonly<FileImport>) {
  return { line, column, specifier, kind };
}

export function toFileGraph(graph: ProjectedFileGraph): FileGraph {
  return {
    level: "file",
    files: graph.files,
    components: graph.components,
    imports: graph.imports.map(({ fileImport, target }) => ({
      fromFileId: fileImport.fromFileId,
      target,
      ...importLocation(fileImport)
    }))
  };
}

export function toComponentDetail(
  component: ArchitectureComponent,
  components: readonly ArchitectureComponent[],
  graph: ProjectedGraph
): ComponentDetail {
  return {
    component,
    children: components.filter((child) => child.parentId === component.id),
    inboundDependencies: graph.dependencies
      .filter((edge) => edge.toComponentId === component.id)
      .map(toProjectedDependency),
    outboundDependencies: graph.dependencies
      .filter((edge) => edge.fromComponentId === component.id)
      .map(toProjectedDependency),
    externalDependencies: graph.externalDependencies.filter(
      (edge) => edge.componentId === component.id
    )
  };
}

export function findProjectedDependency(
  graph: ProjectedGraph,
  { from, to }: Pick<DependencyEvidenceQuery, "from" | "to">
): ProjectedDependency | undefined {
  return graph.dependencies.find(
    (edge) => edge.fromComponentId === from && edge.toComponentId === to
  );
}

/** Map only the evidence IDs in the requested page, using the reader's indexes. */
export function toDependencyEvidence(
  importIds: readonly string[],
  importsById: ReadonlyMap<string, Readonly<FileImport>>,
  filesById: ReadonlyMap<string, Readonly<ArchitectureFile>>
): DependencyEvidence[] {
  return importIds.map((id) => {
    const fileImport = importsById.get(id);
    if (!fileImport) {
      throw new Error(`Missing dependency evidence import "${id}".`);
    }

    const file = filesById.get(fileImport.fromFileId);
    if (!file) {
      throw new Error(`Missing source file for dependency evidence import "${id}".`);
    }

    return { filePath: file.path, role: file.role, ...importLocation(fileImport) };
  });
}
