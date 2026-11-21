import type {
  ArchitectureComponent,
  ArchitectureFile,
  ArchitectureSnapshot,
  ComponentDependency,
  CountsByKind,
  CountsByRole,
  ExternalDependency,
  FileImport,
  FileRole,
  ImportKind
} from "./model.js";
import { findTypedCycles, type GraphCycle } from "./graph-cycles.js";
import { collectVisibleComponentIds, findVisibleAncestor } from "./hierarchy-projection.js";
import { assertSnapshotInvariants } from "./invariants.js";
import { compareStrings } from "./ordering.js";

export interface ProjectGraphFilters {
  includeFileRoles?: readonly FileRole[];
  includeImportKinds?: readonly ImportKind[];
  includeTypeOnly?: boolean;
  /**
   * When false and `includeFileRoles` is set, components whose subtree has no file with an
   * included role are omitted, unless a remaining dependency ends at them. Defaults to true.
   */
  includeEmptyComponents?: boolean;
}

export interface ProjectGraphOptions {
  depth: number;
  expanded?: readonly string[];
  filters?: ProjectGraphFilters;
}

export interface ProjectedDependency {
  fromComponentId: string;
  toComponentId: string;
  weight: number;
  countsByKind: CountsByKind;
  countsByRole: CountsByRole;
  evidenceImportIds: string[];
}

export interface ProjectedExternalDependency {
  componentId: string;
  packageName: string;
  weight: number;
  countsByRole: CountsByRole;
}

export interface ProjectedGraph {
  components: ArchitectureComponent[];
  dependencies: ProjectedDependency[];
  externalDependencies: ProjectedExternalDependency[];
  cycles: GraphCycle[];
}

export type ProjectedFileImportTarget =
  { kind: "file"; fileId: string } | { kind: "component"; componentId: string };

export interface ProjectedFileImport {
  fileImport: Readonly<FileImport>;
  target: ProjectedFileImportTarget;
}

export interface ProjectedFileGraph {
  files: Readonly<ArchitectureFile>[];
  components: ArchitectureComponent[];
  imports: ProjectedFileImport[];
}

export interface SnapshotProjector {
  projectGraph(options: ProjectGraphOptions): ProjectedGraph;
  projectFileGraph(componentId: string, options: ProjectGraphOptions): ProjectedFileGraph;
}

interface SnapshotIndexes {
  componentsById: Map<string, ArchitectureComponent>;
  parentById: Map<string, string | undefined>;
  childrenById: Map<string, ArchitectureComponent[]>;
  filesById: Map<string, ArchitectureFile>;
  filesByComponentId: Map<string, ArchitectureFile[]>;
  importsById: Map<string, FileImport>;
  importsBySourceFileId: Map<string, FileImport[]>;
}

export function projectGraph(
  snapshot: ArchitectureSnapshot,
  options: ProjectGraphOptions
): ProjectedGraph {
  return createSnapshotProjector(snapshot).projectGraph(options);
}

/** Validate domain invariants and index once. The snapshot and shared records must stay immutable. */
export function createSnapshotProjector(snapshot: ArchitectureSnapshot): SnapshotProjector {
  assertSnapshotInvariants(snapshot);
  const indexes = buildIndexes(snapshot);

  return {
    projectGraph(options) {
      const visibleComponentIds = collectVisible(snapshot, options);
      const dependencies = projectDependencies(
        snapshot.dependencies,
        indexes,
        visibleComponentIds,
        createImportFilter(options.filters)
      );
      const shownComponentIds =
        options.filters?.includeEmptyComponents === false
          ? omitComponentsWithoutRoleFiles(
              snapshot,
              indexes,
              visibleComponentIds,
              dependencies,
              options.filters
            )
          : visibleComponentIds;
      const components = snapshot.components
        .filter((component) => shownComponentIds.has(component.id))
        .sort(compareComponents);

      return {
        components,
        dependencies,
        externalDependencies: projectExternalDependencies(
          snapshot.externalDependencies,
          indexes,
          visibleComponentIds,
          new Set(options.filters?.includeFileRoles)
        ),
        cycles: findTypedCycles({
          nodes: components.map((component) => component.id),
          edges: dependencies.map((dependency) => ({
            from: dependency.fromComponentId,
            to: dependency.toComponentId,
            typeOnly: dependency.countsByKind["type-only"] === dependency.weight
          }))
        })
      };
    },
    projectFileGraph(componentId, options) {
      return projectFiles(componentId, indexes, collectVisible(snapshot, options), options.filters);
    }
  };
}

function omitComponentsWithoutRoleFiles(
  snapshot: ArchitectureSnapshot,
  indexes: SnapshotIndexes,
  visibleComponentIds: ReadonlySet<string>,
  dependencies: readonly ProjectedDependency[],
  filters: ProjectGraphFilters
): Set<string> {
  const roles = new Set(filters.includeFileRoles);
  if (roles.size === 0) {
    return new Set(visibleComponentIds);
  }

  const shown = new Set<string>();
  const keepWithAncestors = (componentId: string | undefined) => {
    for (
      let id = componentId;
      id !== undefined && !shown.has(id);
      id = indexes.parentById.get(id)
    ) {
      if (visibleComponentIds.has(id)) {
        shown.add(id);
      }
    }
  };

  for (const file of snapshot.files) {
    if (roles.has(file.role)) {
      keepWithAncestors(file.componentId);
    }
  }
  // A dependency ends at its target even when the target has no file in the selected roles.
  for (const dependency of dependencies) {
    keepWithAncestors(dependency.toComponentId);
  }

  return shown;
}

function collectVisible(snapshot: ArchitectureSnapshot, options: ProjectGraphOptions): Set<string> {
  return collectVisibleComponentIds(
    snapshot.components,
    Math.max(0, options.depth),
    new Set(options.expanded)
  );
}

type ImportFilter = (fileImport: FileImport, fromFile: ArchitectureFile) => boolean;

function createImportFilter(filters?: ProjectGraphFilters): ImportFilter {
  const kinds = new Set(filters?.includeImportKinds);
  const roles = new Set(filters?.includeFileRoles);

  return (fileImport, fromFile) =>
    (filters?.includeTypeOnly !== false || fileImport.kind !== "type-only") &&
    (kinds.size === 0 || kinds.has(fileImport.kind)) &&
    (roles.size === 0 || roles.has(fromFile.role));
}

function buildIndexes(snapshot: ArchitectureSnapshot): SnapshotIndexes {
  return {
    componentsById: new Map(snapshot.components.map((component) => [component.id, component])),
    parentById: new Map(snapshot.components.map((component) => [component.id, component.parentId])),
    childrenById: groupBy(snapshot.components, (component) => component.parentId),
    filesById: new Map(snapshot.files.map((file) => [file.id, file])),
    filesByComponentId: groupBy(snapshot.files, (file) => file.componentId),
    importsById: new Map(snapshot.fileImports.map((item) => [item.id, item])),
    importsBySourceFileId: groupBy(snapshot.fileImports, (item) => item.fromFileId)
  };
}

function groupBy<T>(
  items: readonly T[],
  getKey: (item: T) => string | undefined
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    if (key === undefined) {
      continue;
    }
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

function projectFiles(
  componentId: string,
  indexes: SnapshotIndexes,
  visibleComponentIds: Set<string>,
  filters?: ProjectGraphFilters
): ProjectedFileGraph {
  const component = indexes.componentsById.get(componentId);
  if (!component) {
    throw new Error(`Cannot project files for unknown component "${componentId}".`);
  }

  const files: ArchitectureFile[] = [];
  const pending = [component];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    for (const file of indexes.filesByComponentId.get(node.id) ?? []) {
      files.push(file);
    }
    for (const child of indexes.childrenById.get(node.id) ?? []) {
      pending.push(child);
    }
  }
  files.sort((left, right) => compareStrings(left.path, right.path));
  const subtreeFileIds = new Set(files.map((file) => file.id));
  const matchesFilter = createImportFilter(filters);
  const components = new Map<string, ArchitectureComponent>();
  const imports: ProjectedFileImport[] = [];

  for (const file of files) {
    for (const fileImport of indexes.importsBySourceFileId.get(file.id) ?? []) {
      if (!matchesFilter(fileImport, file)) {
        continue;
      }

      const targetFile =
        fileImport.toFileId === undefined ? undefined : indexes.filesById.get(fileImport.toFileId);
      if (targetFile && subtreeFileIds.has(targetFile.id)) {
        imports.push({ fileImport, target: { kind: "file", fileId: targetFile.id } });
        continue;
      }

      const targetComponentId = targetFile?.componentId ?? fileImport.toComponentId;
      if (targetComponentId === undefined) {
        continue;
      }

      const visibleId = mapToVisibleAncestor(
        targetComponentId,
        indexes.parentById,
        visibleComponentIds
      );
      const targetComponent = indexes.componentsById.get(visibleId);
      if (!targetComponent) {
        throw new Error(
          `Cannot project import "${fileImport.id}" to unknown component "${visibleId}".`
        );
      }
      components.set(visibleId, targetComponent);
      imports.push({ fileImport, target: { kind: "component", componentId: visibleId } });
    }
  }

  return {
    files,
    components: [...components.values()].sort(compareComponents),
    imports: imports.sort((left, right) => compareStrings(left.fileImport.id, right.fileImport.id))
  };
}

function projectDependencies(
  dependencies: ComponentDependency[],
  indexes: SnapshotIndexes,
  visibleComponentIds: Set<string>,
  matchesFilter: ImportFilter
): ProjectedDependency[] {
  const projected = new Map<string, ProjectedDependency>();

  for (const dependency of dependencies) {
    const fromVisibleId = mapToVisibleAncestor(
      dependency.fromComponentId,
      indexes.parentById,
      visibleComponentIds
    );
    const toVisibleId = mapToVisibleAncestor(
      dependency.toComponentId,
      indexes.parentById,
      visibleComponentIds
    );

    if (fromVisibleId === toVisibleId) {
      continue;
    }

    const evidenceImportIds = dependency.evidenceImportIds
      .filter((importId) => {
        const fileImport = indexes.importsById.get(importId);
        if (!fileImport) {
          return false;
        }

        const fromFile = indexes.filesById.get(fileImport.fromFileId);
        return fromFile !== undefined && matchesFilter(fileImport, fromFile);
      })
      .sort();

    if (evidenceImportIds.length === 0) {
      continue;
    }

    const edgeKey = `${fromVisibleId}→${toVisibleId}`;
    const existing = projected.get(edgeKey);
    const target = existing ?? {
      fromComponentId: fromVisibleId,
      toComponentId: toVisibleId,
      weight: 0,
      countsByKind: {},
      countsByRole: {},
      evidenceImportIds: []
    };

    for (const importId of evidenceImportIds) {
      const fileImport = indexes.importsById.get(importId);
      if (!fileImport) {
        continue;
      }

      target.weight += 1;
      incrementCount(target.countsByKind, fileImport.kind);

      const fromFile = indexes.filesById.get(fileImport.fromFileId);
      if (fromFile) {
        incrementCount(target.countsByRole, fromFile.role);
      }
    }

    target.evidenceImportIds = [...target.evidenceImportIds, ...evidenceImportIds].sort();
    projected.set(edgeKey, target);
  }

  return [...projected.values()].sort(compareProjectedDependencies);
}

function projectExternalDependencies(
  externalDependencies: ExternalDependency[],
  indexes: SnapshotIndexes,
  visibleComponentIds: Set<string>,
  fileRolesFilter: ReadonlySet<FileRole>
): ProjectedExternalDependency[] {
  const hasFileRoleFilter = fileRolesFilter.size > 0;
  const projected = new Map<string, ProjectedExternalDependency>();

  for (const dependency of externalDependencies) {
    const visibleComponentId = mapToVisibleAncestor(
      dependency.componentId,
      indexes.parentById,
      visibleComponentIds
    );
    const key = `${visibleComponentId}→${dependency.packageName}`;
    const existing = projected.get(key);
    const target = existing ?? {
      componentId: visibleComponentId,
      packageName: dependency.packageName,
      weight: 0,
      countsByRole: {}
    };

    const roleEntries = Object.entries(dependency.countsByRole).filter(
      (entry): entry is [FileRole, number] =>
        typeof entry[1] === "number" &&
        (!hasFileRoleFilter || fileRolesFilter.has(entry[0] as FileRole))
    );

    if (roleEntries.length > 0) {
      for (const [role, count] of roleEntries) {
        target.weight += count;
        incrementCount(target.countsByRole, role, count);
      }
    } else if (!hasFileRoleFilter) {
      target.weight += dependency.weight;
      for (const [role, count] of Object.entries(dependency.countsByRole)) {
        if (typeof count === "number") {
          incrementCount(target.countsByRole, role as FileRole, count);
        }
      }
    }

    projected.set(key, target);
  }

  return [...projected.values()]
    .filter((dependency) => dependency.weight > 0)
    .sort(compareProjectedExternalDependencies);
}

function mapToVisibleAncestor(
  componentId: string,
  parentById: Map<string, string | undefined>,
  visibleComponentIds: Set<string>
): string {
  const visibleId = findVisibleAncestor(componentId, parentById, visibleComponentIds);
  if (visibleId === undefined) {
    throw new Error(
      `Cannot project component "${componentId}" because it has no visible ancestor.`
    );
  }

  return visibleId;
}

function incrementCount(record: Record<string, number>, key: string, increment = 1): void {
  record[key] = (record[key] ?? 0) + increment;
}

function compareComponents(a: ArchitectureComponent, b: ArchitectureComponent): number {
  if (a.depth !== b.depth) {
    return a.depth - b.depth;
  }

  return compareStrings(a.id, b.id);
}

function compareProjectedDependencies(a: ProjectedDependency, b: ProjectedDependency): number {
  if (a.fromComponentId !== b.fromComponentId) {
    return compareStrings(a.fromComponentId, b.fromComponentId);
  }

  return compareStrings(a.toComponentId, b.toComponentId);
}

function compareProjectedExternalDependencies(
  a: ProjectedExternalDependency,
  b: ProjectedExternalDependency
): number {
  if (a.componentId !== b.componentId) {
    return compareStrings(a.componentId, b.componentId);
  }

  return compareStrings(a.packageName, b.packageName);
}
