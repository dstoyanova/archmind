import { createHash } from "node:crypto";
import path from "node:path";

import {
  architectureSnapshotSchema,
  type ArchitectureSnapshotDocument
} from "@archmind/contracts";
import { canonicalJson, compareStrings } from "@archmind/domain";

import {
  buildGraphMetricsAndCycles,
  type GraphComponentInput
} from "./graph-metrics-cycles.js";

type SnapshotSource = ArchitectureSnapshotDocument["source"];
type SnapshotDiagnostic = ArchitectureSnapshotDocument["diagnostics"][number];
type SnapshotResolutionStats = ArchitectureSnapshotDocument["resolutionStats"];

export interface SnapshotBuilderComponentInput {
  id: string;
  name: string;
  parentId?: string | undefined;
  depth: number;
  kind: ArchitectureSnapshotDocument["components"][number]["kind"];
  paths: string[];
}

export interface SnapshotBuilderOwnershipInput {
  filePath: string;
  componentId: string;
}

export interface SnapshotBuilderFileInput {
  path: string;
  role: ArchitectureSnapshotDocument["files"][number]["role"];
  language?: string | undefined;
  loc?: number | undefined;
  parseStatus?: string | undefined;
}

export interface SnapshotBuilderImportInput {
  filePath: string;
  specifier: string;
  kind: ArchitectureSnapshotDocument["fileImports"][number]["kind"];
  line: number;
  column: number;
  resolution: ArchitectureSnapshotDocument["fileImports"][number]["resolution"];
  resolvedFilePath?: string | undefined;
  workspacePackage?: string | undefined;
  externalPackage?: string | undefined;
}

export interface SnapshotBuilderSymbolInput {
  filePath: string;
  name: string;
  kind: ArchitectureSnapshotDocument["symbols"][number]["kind"];
  line: number;
  column: number;
}

export interface SnapshotBuilderInput {
  schemaVersion?: string | undefined;
  engineVersion: string;
  parserVersion: string;
  analysisConfigHash: string;
  source: SnapshotSource;
  createdAt?: string | undefined;
  components: SnapshotBuilderComponentInput[];
  ownership: SnapshotBuilderOwnershipInput[];
  files: SnapshotBuilderFileInput[];
  fileImports: SnapshotBuilderImportInput[];
  symbols: SnapshotBuilderSymbolInput[];
  resolutionStats: SnapshotResolutionStats;
  diagnostics: SnapshotDiagnostic[];
  workspacePackageComponents?: Record<string, string> | undefined;
}

export const DEFAULT_SNAPSHOT_SCHEMA_VERSION = "1";

export function buildArchitectureSnapshot(
  input: SnapshotBuilderInput
): ArchitectureSnapshotDocument {
  const normalizedComponents = normalizeComponents(input.components);
  const componentIdByInputId = new Map<string, string>();
  for (const component of normalizedComponents) {
    componentIdByInputId.set(component.inputId, component.id);
  }

  const ownershipByFilePath = buildOwnershipMap(input.ownership);
  const parseStatusByFilePath = buildParseStatusMap(input.diagnostics);

  const files = normalizeFiles(
    input.files,
    ownershipByFilePath,
    componentIdByInputId,
    parseStatusByFilePath
  );
  const fileIdByPath = new Map(files.map((file) => [file.path, file.id] as const));
  const componentIdByFilePath = new Map(
    files.map((file) => [file.path, file.componentId] as const)
  );

  const fileImports = normalizeFileImports(
    input.fileImports,
    fileIdByPath,
    componentIdByFilePath,
    input.workspacePackageComponents,
    componentIdByInputId
  );

  const symbols = normalizeSymbols(input.symbols, fileIdByPath);

  const graphInputComponents: GraphComponentInput[] = normalizedComponents.map((component) => ({
    id: component.id,
    name: component.name,
    parentId: component.parentId,
    depth: component.depth,
    kind: component.kind,
    paths: component.paths
  }));
  const graph = buildGraphMetricsAndCycles({
    components: graphInputComponents,
    files,
    fileImports
  });

  const diagnostics = normalizeDiagnostics(input.diagnostics);
  const resolutionStats = normalizeResolutionStats(input.resolutionStats);

  const baseSnapshot: ArchitectureSnapshotDocument = {
    schemaVersion: input.schemaVersion ?? DEFAULT_SNAPSHOT_SCHEMA_VERSION,
    engineVersion: input.engineVersion,
    parserVersion: input.parserVersion,
    analysisConfigHash: input.analysisConfigHash,
    contentHash: "",
    source: {
      ...input.source
    },
    createdAt: input.createdAt ?? new Date().toISOString(),
    components: graph.components,
    files,
    symbols,
    fileImports,
    dependencies: graph.dependencies,
    externalDependencies: graph.externalDependencies,
    cycles: graph.cycles,
    resolutionStats,
    diagnostics
  };

  const contentHash = computeContentHash(baseSnapshot);
  return architectureSnapshotSchema.parse({
    ...baseSnapshot,
    contentHash
  });
}

function normalizeComponents(
  components: SnapshotBuilderComponentInput[]
): Array<Omit<ArchitectureSnapshotDocument["components"][number], "metrics"> & { inputId: string }> {
  const sortedComponents = [...components].sort((left, right) => {
    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }

    return compareStrings(left.id, right.id);
  });
  const normalized: Array<
    Omit<ArchitectureSnapshotDocument["components"][number], "metrics"> & {
      inputId: string;
    }
  > = [];
  const normalizedIdByInputId = new Map<string, string>();

  for (const component of sortedComponents) {
    const id = deterministicId("cmp", component.id);
    const parentId = component.parentId
      ? normalizedIdByInputId.get(component.parentId)
      : undefined;

    normalized.push({
      inputId: component.id,
      id,
      name: component.name,
      parentId,
      depth: component.depth,
      kind: component.kind,
      paths: [...new Set(component.paths)].sort()
    });
    normalizedIdByInputId.set(component.id, id);
  }

  return normalized;
}

function buildOwnershipMap(
  ownership: SnapshotBuilderOwnershipInput[]
): Map<string, string> {
  const ownershipByPath = new Map<string, string>();
  for (const entry of ownership) {
    const existing = ownershipByPath.get(entry.filePath);
    if (existing && existing !== entry.componentId) {
      throw new Error(
        `File "${entry.filePath}" has conflicting component ownership (${existing} vs ${entry.componentId}).`
      );
    }

    ownershipByPath.set(entry.filePath, entry.componentId);
  }

  return ownershipByPath;
}

function buildParseStatusMap(
  diagnostics: SnapshotDiagnostic[]
): Map<string, "read-error" | "parse-error"> {
  const parseStatusByFilePath = new Map<string, "read-error" | "parse-error">();

  for (const diagnostic of diagnostics) {
    if (!diagnostic.filePath) {
      continue;
    }

    if (diagnostic.code === "SOURCE_FILE_READ_FAILED") {
      parseStatusByFilePath.set(diagnostic.filePath, "read-error");
      continue;
    }

    if (diagnostic.code === "SOURCE_FILE_PARSE_ERROR") {
      const existing = parseStatusByFilePath.get(diagnostic.filePath);
      if (existing !== "read-error") {
        parseStatusByFilePath.set(diagnostic.filePath, "parse-error");
      }
    }
  }

  return parseStatusByFilePath;
}

function normalizeFiles(
  files: SnapshotBuilderFileInput[],
  ownershipByFilePath: Map<string, string>,
  componentIdByInputId: Map<string, string>,
  parseStatusByFilePath: Map<string, "read-error" | "parse-error">
): ArchitectureSnapshotDocument["files"] {
  return [...files]
    .sort((left, right) => compareStrings(left.path, right.path))
    .map((file) => {
      const owningInputComponentId = ownershipByFilePath.get(file.path);
      if (!owningInputComponentId) {
        throw new Error(`Missing component ownership for file "${file.path}".`);
      }

      const owningComponentId = componentIdByInputId.get(owningInputComponentId);
      if (!owningComponentId) {
        throw new Error(
          `File "${file.path}" references unknown component "${owningInputComponentId}".`
        );
      }

      return {
        id: deterministicId("file", file.path),
        path: file.path,
        componentId: owningComponentId,
        role: file.role,
        language: file.language ?? resolveLanguage(file.path),
        loc: file.loc ?? 0,
        parseStatus:
          file.parseStatus ?? parseStatusByFilePath.get(file.path) ?? "parsed"
      };
    });
}

function normalizeFileImports(
  fileImports: SnapshotBuilderImportInput[],
  fileIdByPath: Map<string, string>,
  componentIdByFilePath: Map<string, string>,
  workspacePackageComponents: Record<string, string> | undefined,
  componentIdByInputId: Map<string, string>
): ArchitectureSnapshotDocument["fileImports"] {
  return [...fileImports]
    .sort(compareImportInput)
    .flatMap((fileImport) => {
      const fromFileId = fileIdByPath.get(fileImport.filePath);
      if (!fromFileId) {
        return [];
      }

      const toFileId = fileImport.resolvedFilePath
        ? fileIdByPath.get(fileImport.resolvedFilePath)
        : undefined;
      const toComponentId = toFileId
        ? componentIdByFilePath.get(fileImport.resolvedFilePath ?? "")
        : resolveWorkspacePackageComponentId(
            fileImport.workspacePackage,
            workspacePackageComponents,
            componentIdByInputId
          );
      const externalPackage =
        fileImport.resolution === "external-package"
          ? (fileImport.externalPackage ?? extractPackageName(fileImport.specifier))
          : undefined;

      return [
        {
          id: deterministicId(
            "imp",
            [
              fileImport.filePath,
              String(fileImport.line),
              String(fileImport.column),
              fileImport.specifier,
              fileImport.kind
            ].join("|")
          ),
          fromFileId,
          specifier: fileImport.specifier,
          kind: fileImport.kind,
          resolution: fileImport.resolution,
          toFileId,
          toComponentId,
          externalPackage,
          line: fileImport.line,
          column: fileImport.column
        }
      ];
    });
}

function normalizeSymbols(
  symbols: SnapshotBuilderSymbolInput[],
  fileIdByPath: Map<string, string>
): ArchitectureSnapshotDocument["symbols"] {
  return [...symbols]
    .sort((left, right) => {
      if (left.filePath !== right.filePath) {
        return compareStrings(left.filePath, right.filePath);
      }

      if (left.line !== right.line) {
        return left.line - right.line;
      }

      if (left.column !== right.column) {
        return left.column - right.column;
      }

      if (left.name !== right.name) {
        return compareStrings(left.name, right.name);
      }

      return compareStrings(left.kind, right.kind);
    })
    .flatMap((symbol) => {
      const fileId = fileIdByPath.get(symbol.filePath);
      if (!fileId) {
        return [];
      }

      return [
        {
          id: deterministicId(
            "sym",
            [
              symbol.filePath,
              String(symbol.line),
              String(symbol.column),
              symbol.kind,
              symbol.name
            ].join("|")
          ),
          fileId,
          name: symbol.name,
          kind: symbol.kind,
          line: symbol.line,
          column: symbol.column
        }
      ];
    });
}

function normalizeDiagnostics(
  diagnostics: SnapshotDiagnostic[]
): SnapshotDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    if (left.severity !== right.severity) {
      return compareStrings(left.severity, right.severity);
    }

    if (left.code !== right.code) {
      return compareStrings(left.code, right.code);
    }

    if (left.filePath !== right.filePath) {
      return compareStrings(left.filePath ?? "", right.filePath ?? "");
    }

    if (left.line !== right.line) {
      return (left.line ?? 0) - (right.line ?? 0);
    }

    return compareStrings(left.message, right.message);
  });
}

function normalizeResolutionStats(
  resolutionStats: SnapshotResolutionStats
): SnapshotResolutionStats {
  const countsByResolution = Object.fromEntries(
    Object.entries(resolutionStats.countsByResolution)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .sort(([left], [right]) => compareStrings(left, right))
  );

  return {
    countsByResolution,
    unresolvedRate: resolutionStats.unresolvedRate
  };
}

function resolveWorkspacePackageComponentId(
  workspacePackage: string | undefined,
  workspacePackageComponents: Record<string, string> | undefined,
  componentIdByInputId: Map<string, string>
): string | undefined {
  if (!workspacePackage || !workspacePackageComponents) {
    return undefined;
  }

  const inputComponentId = workspacePackageComponents[workspacePackage];
  if (!inputComponentId) {
    return undefined;
  }

  return componentIdByInputId.get(inputComponentId);
}

function resolveLanguage(filePath: string): string {
  const extension = path.posix.extname(filePath).replace(/^\./u, "");
  return extension || "unknown";
}

function compareImportInput(
  left: SnapshotBuilderImportInput,
  right: SnapshotBuilderImportInput
): number {
  if (left.filePath !== right.filePath) {
    return compareStrings(left.filePath, right.filePath);
  }

  if (left.line !== right.line) {
    return left.line - right.line;
  }

  if (left.column !== right.column) {
    return left.column - right.column;
  }

  if (left.specifier !== right.specifier) {
    return compareStrings(left.specifier, right.specifier);
  }

  return compareStrings(left.kind, right.kind);
}

function computeContentHash(snapshot: ArchitectureSnapshotDocument): string {
  const payload = {
    engineVersion: snapshot.engineVersion,
    parserVersion: snapshot.parserVersion,
    analysisConfigHash: snapshot.analysisConfigHash,
    components: snapshot.components,
    files: snapshot.files,
    symbols: snapshot.symbols,
    fileImports: snapshot.fileImports,
    dependencies: snapshot.dependencies,
    externalDependencies: snapshot.externalDependencies,
    cycles: snapshot.cycles,
    diagnostics: snapshot.diagnostics,
    resolutionStats: snapshot.resolutionStats
  };

  return sha256Hex(canonicalJson(payload));
}

function deterministicId(prefix: string, key: string): string {
  return `${prefix}:${sha256Hex(key)}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function extractPackageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    const segments = specifier.split("/");
    const scope = segments[0];
    const packageName = segments[1];
    if (scope && packageName) {
      return `${scope}/${packageName}`;
    }
  }

  const [packageName] = specifier.split("/");
  return packageName ?? specifier;
}
