import type { AnalysisConfig } from "@archmind/contracts";
import { compareStrings } from "@archmind/domain";
import { minimatch } from "minimatch";

export type ComponentKind = "configured" | "package" | "folder" | "root";

export interface HierarchyComponent {
  id: string;
  name: string;
  parentId?: string | undefined;
  depth: number;
  kind: ComponentKind;
  paths: string[];
}

export interface FileOwnership {
  filePath: string;
  componentId: string;
}

export interface MapFilesToComponentHierarchyInput {
  analysisConfig: AnalysisConfig;
  filePaths: string[];
  packageDirectories: string[];
}

export interface HierarchyDiagnostic {
  severity: "warning";
  code:
    | "CONFIG_COMPONENT_PARENT_UNKNOWN"
    | "CONFIG_COMPONENT_PARENT_CYCLE"
    | "CONFIG_NESTED_FOLDER_UNKNOWN";
  message: string;
}

export interface MapFilesToComponentHierarchyResult {
  components: HierarchyComponent[];
  ownership: FileOwnership[];
  diagnostics: HierarchyDiagnostic[];
}

const MINIMATCH_OPTIONS = {
  dot: true,
  nobrace: false,
  noext: false
} as const;

type InternalComponent = HierarchyComponent;

interface PackageContext {
  id: string;
  packageDirectory: string;
  componentRootPath: string;
}

interface ConfiguredMatch {
  componentId: string;
  score: number;
}

export function mapFilesToComponentHierarchy(
  input: MapFilesToComponentHierarchyInput
): MapFilesToComponentHierarchyResult {
  const filePaths = [...new Set(input.filePaths.map(normalizePath))].sort();
  const packageDirectories = normalizePackageDirectories(input.packageDirectories);

  const components: InternalComponent[] = [
    {
      id: "root",
      name: "<root>",
      depth: 0,
      kind: "root",
      paths: ["."]
    }
  ];
  const componentById = new Map<string, InternalComponent>([["root", components[0]!]]);

  const packageContexts = createPackageComponents(
    packageDirectories,
    filePaths,
    input.analysisConfig,
    components,
    componentById
  );

  const diagnostics: HierarchyDiagnostic[] = [];
  const packageIdByFolderId = createFolderComponents(
    packageContexts,
    filePaths,
    packageDirectories,
    components,
    componentById
  );
  createNestedFolderComponents(
    input.analysisConfig.nestedFolders ?? [],
    filePaths,
    packageDirectories,
    components,
    componentById,
    packageIdByFolderId,
    diagnostics
  );

  const configuredComponents = createConfiguredComponents(
    input.analysisConfig,
    components,
    componentById,
    diagnostics
  );

  const packageComponentsByDirectory = new Map(
    packageContexts.map((pkg) => [pkg.packageDirectory, pkg.id] as const)
  );
  const folderComponents = components.filter((component) => component.kind === "folder");

  const ownership: FileOwnership[] = filePaths.map((filePath) => {
    const configuredMatch = findConfiguredMatch(filePath, configuredComponents);
    if (configuredMatch) {
      return {
        filePath,
        componentId: configuredMatch.componentId
      };
    }

    const packageDirectory = findOwningPackageDirectory(filePath, packageDirectories);
    if (!packageDirectory) {
      return {
        filePath,
        componentId: "root"
      };
    }

    const packageComponentId = packageComponentsByDirectory.get(packageDirectory);
    if (!packageComponentId) {
      return {
        filePath,
        componentId: "root"
      };
    }

    const folderMatch = findOwningFolderComponent(
      filePath,
      folderComponents,
      packageComponentId,
      packageIdByFolderId
    );
    if (folderMatch) {
      return {
        filePath,
        componentId: folderMatch.id
      };
    }

    return {
      filePath,
      componentId: packageComponentId
    };
  });

  const publicComponents = components.sort(compareComponents);

  return {
    components: publicComponents,
    ownership,
    diagnostics: diagnostics.sort(
      (left, right) =>
        compareStrings(left.code, right.code) || compareStrings(left.message, right.message)
    )
  };
}

function createPackageComponents(
  packageDirectories: string[],
  filePaths: string[],
  analysisConfig: AnalysisConfig,
  components: InternalComponent[],
  componentById: Map<string, InternalComponent>
): PackageContext[] {
  const packageContexts: PackageContext[] = [];

  for (const packageDirectory of packageDirectories) {
    const componentId = buildComponentId("package", packageDirectory);
    const componentRootPath = resolveComponentRootPath(packageDirectory, filePaths, analysisConfig);
    const component: InternalComponent = {
      id: componentId,
      name: packageDirectory === "." ? "<package-root>" : basename(packageDirectory),
      parentId: "root",
      depth: 1,
      kind: "package",
      paths: [packageDirectory]
    };
    components.push(component);
    componentById.set(componentId, component);
    packageContexts.push({
      id: componentId,
      packageDirectory,
      componentRootPath
    });
  }

  return packageContexts.sort((left, right) =>
    compareStrings(left.packageDirectory, right.packageDirectory)
  );
}

function createFolderComponents(
  packageContexts: PackageContext[],
  filePaths: string[],
  packageDirectories: string[],
  components: InternalComponent[],
  componentById: Map<string, InternalComponent>
): Map<string, string> {
  const packageIdByFolderId = new Map<string, string>();
  for (const pkg of packageContexts) {
    const ownedFilePaths = filePaths.filter(
      (filePath) =>
        findOwningPackageDirectory(filePath, packageDirectories) === pkg.packageDirectory
    );
    const childFolders = findImmediateFoldersUnderRoot(ownedFilePaths, pkg.componentRootPath);
    for (const folderPath of childFolders) {
      const folderName = folderPath.split("/").at(-1);
      if (!folderName) {
        continue;
      }

      const component: InternalComponent = {
        id: buildComponentId("folder", folderPath),
        name: folderName,
        parentId: pkg.id,
        depth: 2,
        kind: "folder",
        paths: [folderPath]
      };
      components.push(component);
      componentById.set(component.id, component);
      packageIdByFolderId.set(component.id, pkg.id);
    }
  }

  return packageIdByFolderId;
}

/**
 * Gives each listed folder component child components for its immediate subfolders. Entries are
 * applied shallowest first, so a listed folder may itself be created by an earlier entry.
 */
function createNestedFolderComponents(
  nestedFolders: readonly string[],
  filePaths: string[],
  packageDirectories: string[],
  components: InternalComponent[],
  componentById: Map<string, InternalComponent>,
  packageIdByFolderId: Map<string, string>,
  diagnostics: HierarchyDiagnostic[]
): void {
  const ordered = [...nestedFolders]
    .map(normalizePath)
    .sort(
      (left, right) =>
        left.split("/").length - right.split("/").length || compareStrings(left, right)
    );

  for (const folderPath of ordered) {
    const parent = componentById.get(buildComponentId("folder", folderPath));
    const packageId = parent && packageIdByFolderId.get(parent.id);
    const packageDirectory = packageId && componentById.get(packageId)?.paths[0];
    if (!parent || !packageId || packageDirectory === undefined) {
      diagnostics.push({
        severity: "warning",
        code: "CONFIG_NESTED_FOLDER_UNKNOWN",
        message: `Nested folder "${folderPath}" is not a folder component; ignoring it.`
      });
      continue;
    }

    const ownedFilePaths = filePaths.filter(
      (filePath) => findOwningPackageDirectory(filePath, packageDirectories) === packageDirectory
    );
    for (const childPath of findImmediateFoldersUnderRoot(ownedFilePaths, folderPath)) {
      const child: InternalComponent = {
        id: buildComponentId("folder", childPath),
        name: childPath.split("/").at(-1) ?? childPath,
        parentId: parent.id,
        depth: parent.depth + 1,
        kind: "folder",
        paths: [childPath]
      };
      components.push(child);
      componentById.set(child.id, child);
      packageIdByFolderId.set(child.id, packageId);
    }
  }
}

function createConfiguredComponents(
  analysisConfig: AnalysisConfig,
  components: InternalComponent[],
  componentById: Map<string, InternalComponent>,
  diagnostics: HierarchyDiagnostic[]
): InternalComponent[] {
  const configured = analysisConfig.components;
  const configuredByName = new Map<string, InternalComponent>();
  const pending = new Map(configured.map((entry) => [entry.name, entry] as const));
  const root = componentById.get("root");
  if (!root) {
    throw new Error("Component hierarchy is missing its root component.");
  }

  while (pending.size > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of configured) {
        if (!pending.has(entry.name)) {
          continue;
        }

        const parentComponent =
          entry.parent === undefined ? root : configuredByName.get(entry.parent);
        if (!parentComponent) {
          continue;
        }

        addConfiguredComponent(entry, parentComponent, components, componentById, configuredByName);
        pending.delete(entry.name);
        changed = true;
      }
    }

    // Remaining entries have an unknown parent or sit on, or below, a parent cycle. Attach the
    // first root cause to the root and report it; its descendants then resolve normally.
    const rootCause = configured.find(
      (entry) =>
        pending.has(entry.name) &&
        (entry.parent === undefined ||
          !pending.has(entry.parent) ||
          isOnParentCycle(entry, pending))
    );
    if (!rootCause) {
      break;
    }

    diagnostics.push(
      pending.has(rootCause.parent ?? "")
        ? {
            severity: "warning",
            code: "CONFIG_COMPONENT_PARENT_CYCLE",
            message: `Configured component "${rootCause.name}" is on a parent cycle; attaching it to the root.`
          }
        : {
            severity: "warning",
            code: "CONFIG_COMPONENT_PARENT_UNKNOWN",
            message: `Configured component "${rootCause.name}" references unknown parent "${rootCause.parent ?? ""}"; attaching it to the root.`
          }
    );
    addConfiguredComponent(rootCause, root, components, componentById, configuredByName);
    pending.delete(rootCause.name);
  }

  return [...configuredByName.values()].sort(compareComponents);
}

function isOnParentCycle(
  entry: AnalysisConfig["components"][number],
  pending: ReadonlyMap<string, AnalysisConfig["components"][number]>
): boolean {
  const visited = new Set<string>();
  let current = entry.parent === undefined ? undefined : pending.get(entry.parent);
  while (current && !visited.has(current.name)) {
    if (current.name === entry.name) {
      return true;
    }

    visited.add(current.name);
    current = current.parent === undefined ? undefined : pending.get(current.parent);
  }

  return false;
}

function addConfiguredComponent(
  entry: AnalysisConfig["components"][number],
  parentComponent: InternalComponent,
  components: InternalComponent[],
  componentById: Map<string, InternalComponent>,
  configuredByName: Map<string, InternalComponent>
): void {
  const component: InternalComponent = {
    // Derived from the unique name, not the array position, so reordering the config keeps IDs stable.
    id: buildComponentId("configured", entry.name),
    name: entry.name,
    parentId: parentComponent.id,
    depth: parentComponent.depth + 1,
    kind: "configured",
    paths: entry.paths.map(normalizePath)
  };
  components.push(component);
  componentById.set(component.id, component);
  configuredByName.set(entry.name, component);
}

function findConfiguredMatch(
  filePath: string,
  configuredComponents: InternalComponent[]
): ConfiguredMatch | null {
  const matches: ConfiguredMatch[] = [];
  for (const component of configuredComponents) {
    for (const pattern of component.paths) {
      if (!minimatch(filePath, pattern, MINIMATCH_OPTIONS)) {
        continue;
      }

      matches.push({
        componentId: component.id,
        score: specificityScore(pattern)
      });
    }
  }

  if (matches.length === 0) {
    return null;
  }

  matches.sort((left, right) => {
    if (left.score !== right.score) {
      return right.score - left.score;
    }

    return compareStrings(left.componentId, right.componentId);
  });

  return matches[0] ?? null;
}

function findOwningPackageDirectory(filePath: string, packageDirectories: string[]): string | null {
  const matches = packageDirectories
    .filter((directory) => containsPath(directory, filePath))
    .sort((left, right) => right.length - left.length || compareStrings(left, right));
  return matches[0] ?? null;
}

function findOwningFolderComponent(
  filePath: string,
  folderComponents: InternalComponent[],
  parentPackageComponentId: string,
  packageIdByFolderId: ReadonlyMap<string, string>
): InternalComponent | null {
  const matches = folderComponents
    .filter(
      (component) =>
        packageIdByFolderId.get(component.id) === parentPackageComponentId &&
        component.paths.some((folderPath) => containsPath(folderPath, filePath))
    )
    .sort((left, right) => {
      const leftPathLength = left.paths[0]?.length ?? 0;
      const rightPathLength = right.paths[0]?.length ?? 0;
      if (leftPathLength !== rightPathLength) {
        return rightPathLength - leftPathLength;
      }

      return compareStrings(left.id, right.id);
    });

  return matches[0] ?? null;
}

function resolveComponentRootPath(
  packageDirectory: string,
  filePaths: string[],
  analysisConfig: AnalysisConfig
): string {
  const configuredRoot = analysisConfig.componentRoots[packageDirectory];
  if (configuredRoot) {
    return normalizePath(joinPath(packageDirectory, configuredRoot));
  }

  const packageSrc = normalizePath(joinPath(packageDirectory, "src"));
  const hasSrcFiles = filePaths.some((filePath) => containsPath(packageSrc, filePath));
  if (hasSrcFiles) {
    return packageSrc;
  }

  return packageDirectory;
}

function findImmediateFoldersUnderRoot(filePaths: string[], rootPath: string): string[] {
  const folders = new Set<string>();

  for (const filePath of filePaths) {
    if (!containsPath(rootPath, filePath)) {
      continue;
    }

    if (rootPath === ".") {
      const [first, second] = filePath.split("/");
      if (!first || !second) {
        continue;
      }

      folders.add(first);
      continue;
    }

    if (filePath.length <= rootPath.length) {
      continue;
    }

    const relative = filePath.slice(rootPath.length + 1);
    const [folderSegment, nestedSegment] = relative.split("/");
    if (!folderSegment || !nestedSegment) {
      continue;
    }

    folders.add(normalizePath(`${rootPath}/${folderSegment}`));
  }

  return [...folders].sort(compareStrings);
}

function normalizePackageDirectories(packageDirectories: string[]): string[] {
  return [...new Set(packageDirectories.map(normalizePath))].sort(
    (left, right) => left.length - right.length || compareStrings(left, right)
  );
}

function normalizePath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/").replace(/\/+/gu, "/").replace(/\/$/u, "");
  return normalized === "" ? "." : normalized;
}

function basename(directory: string): string {
  if (directory === ".") {
    return ".";
  }

  return directory.split("/").at(-1) ?? directory;
}

function containsPath(basePath: string, targetPath: string): boolean {
  if (basePath === ".") {
    return true;
  }

  return targetPath === basePath || targetPath.startsWith(`${basePath}/`);
}

function joinPath(left: string, right: string): string {
  if (left === ".") {
    return right;
  }

  return `${left}/${right}`;
}

function specificityScore(pattern: string): number {
  let score = 0;
  for (const char of pattern) {
    if ("*?[]{}".includes(char)) {
      continue;
    }

    score += 1;
  }

  return score;
}

function buildComponentId(kind: ComponentKind, key: string): string {
  return `${kind}:${key}`;
}

function compareComponents(left: HierarchyComponent, right: HierarchyComponent): number {
  if (left.depth !== right.depth) {
    return left.depth - right.depth;
  }

  return compareStrings(left.id, right.id);
}
