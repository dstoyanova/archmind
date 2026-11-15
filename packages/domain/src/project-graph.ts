import type {
  ArchitectureComponent,
  ArchitectureSnapshot,
  ComponentDependency,
  CountsByKind,
  CountsByRole,
  ExternalDependency,
  FileImport,
  FileRole,
  ImportKind
} from "./model.js";
import { assertSnapshotInvariants } from "./invariants.js";

export interface ProjectGraphFilters {
  includeFileRoles?: FileRole[];
  includeImportKinds?: ImportKind[];
  includeTypeOnly?: boolean;
}

export interface ProjectGraphOptions {
  depth: number;
  expanded?: string[];
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
}

interface SnapshotIndexes {
  componentsById: Map<string, ArchitectureComponent>;
  childrenById: Map<string, string[]>;
  parentById: Map<string, string | undefined>;
  filesById: Map<string, ArchitectureSnapshot["files"][number]>;
  importsById: Map<string, FileImport>;
}

const DEFAULT_FILTERS: Required<ProjectGraphFilters> = {
  includeFileRoles: [],
  includeImportKinds: [],
  includeTypeOnly: true
};

export function projectGraph(
  snapshot: ArchitectureSnapshot,
  options: ProjectGraphOptions
): ProjectedGraph {
  assertSnapshotInvariants(snapshot);

  const depth = Math.max(0, options.depth);
  const expanded = new Set(options.expanded ?? []);
  const filters = {
    ...DEFAULT_FILTERS,
    ...options.filters
  };

  const indexes = buildIndexes(snapshot);
  const visibleComponentIds = collectVisibleComponents(
    snapshot.components,
    indexes.childrenById,
    depth,
    expanded
  );
  const projectedComponents = snapshot.components
    .filter((component) => visibleComponentIds.has(component.id))
    .sort(compareComponents);

  const projectedDependencies = projectDependencies(
    snapshot.dependencies,
    indexes,
    visibleComponentIds,
    filters
  );

  const projectedExternalDependencies = projectExternalDependencies(
    snapshot.externalDependencies,
    indexes,
    visibleComponentIds,
    filters
  );

  return {
    components: projectedComponents,
    dependencies: projectedDependencies,
    externalDependencies: projectedExternalDependencies
  };
}

function buildIndexes(snapshot: ArchitectureSnapshot): SnapshotIndexes {
  const componentsById = new Map(
    snapshot.components.map((component) => [component.id, component] as const)
  );
  const childrenById = new Map<string, string[]>();
  const parentById = new Map<string, string | undefined>();

  for (const component of snapshot.components) {
    parentById.set(component.id, component.parentId);
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

  return {
    componentsById,
    childrenById,
    parentById,
    filesById: new Map(snapshot.files.map((file) => [file.id, file] as const)),
    importsById: new Map(snapshot.fileImports.map((item) => [item.id, item] as const))
  };
}

function collectVisibleComponents(
  components: ArchitectureComponent[],
  childrenById: Map<string, string[]>,
  depth: number,
  expanded: Set<string>
): Set<string> {
  const visible = new Set(
    components.filter((component) => component.depth <= depth).map((component) => component.id)
  );

  let changed = true;
  while (changed) {
    changed = false;

    for (const component of components) {
      if (!visible.has(component.id)) {
        continue;
      }

      const shouldExpand = component.depth < depth || expanded.has(component.id);
      if (!shouldExpand) {
        continue;
      }

      const children = childrenById.get(component.id) ?? [];
      for (const childId of children) {
        if (visible.has(childId)) {
          continue;
        }

        visible.add(childId);
        changed = true;
      }
    }
  }

  return visible;
}

function projectDependencies(
  dependencies: ComponentDependency[],
  indexes: SnapshotIndexes,
  visibleComponentIds: Set<string>,
  filters: Required<ProjectGraphFilters>
): ProjectedDependency[] {
  const projected = new Map<string, ProjectedDependency>();
  const importKindsFilter = new Set(filters.includeImportKinds);
  const fileRolesFilter = new Set(filters.includeFileRoles);
  const hasImportKindFilter = importKindsFilter.size > 0;
  const hasFileRoleFilter = fileRolesFilter.size > 0;

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

        if (!filters.includeTypeOnly && fileImport.kind === "type-only") {
          return false;
        }

        if (hasImportKindFilter && !importKindsFilter.has(fileImport.kind)) {
          return false;
        }

        const fromFile = indexes.filesById.get(fileImport.fromFileId);
        if (!fromFile) {
          return false;
        }

        if (hasFileRoleFilter && !fileRolesFilter.has(fromFile.role)) {
          return false;
        }

        return true;
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
  filters: Required<ProjectGraphFilters>
): ProjectedExternalDependency[] {
  const fileRolesFilter = new Set(filters.includeFileRoles);
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
  let currentId: string | undefined = componentId;
  while (currentId) {
    if (visibleComponentIds.has(currentId)) {
      return currentId;
    }

    currentId = parentById.get(currentId);
  }

  throw new Error(
    `Cannot project component "${componentId}" because it has no visible ancestor.`
  );
}

function incrementCount(
  record: Record<string, number>,
  key: string,
  increment = 1
): void {
  record[key] = (record[key] ?? 0) + increment;
}

function compareComponents(a: ArchitectureComponent, b: ArchitectureComponent): number {
  if (a.depth !== b.depth) {
    return a.depth - b.depth;
  }

  return a.id.localeCompare(b.id);
}

function compareProjectedDependencies(
  a: ProjectedDependency,
  b: ProjectedDependency
): number {
  if (a.fromComponentId !== b.fromComponentId) {
    return a.fromComponentId.localeCompare(b.fromComponentId);
  }

  return a.toComponentId.localeCompare(b.toComponentId);
}

function compareProjectedExternalDependencies(
  a: ProjectedExternalDependency,
  b: ProjectedExternalDependency
): number {
  if (a.componentId !== b.componentId) {
    return a.componentId.localeCompare(b.componentId);
  }

  return a.packageName.localeCompare(b.packageName);
}
