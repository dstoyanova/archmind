import { builtinModules } from "node:module";
import path from "node:path";

import { compareStrings } from "@archmind/domain";
import ts from "typescript";

import type { ExtractedFileImport } from "./import-symbol-extractor.js";
import { discoverRepositoryFiles } from "./repository-files.js";
import {
  discoverWorkspace,
  type PackageManifest,
  type WorkspaceDiscoveryResult
} from "./workspace-discovery.js";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const COMPILED_EXTENSIONS = [".d.ts", ".d.mts", ".d.cts", ".js", ".jsx", ".mjs", ".cjs"];
// TypeScript diagnostic codes: "No inputs were found in config file" and "File '{0}' not found".
const TS_NO_INPUTS_FOUND = 18003;
const TS_FILE_NOT_FOUND = 6053;

const NODE_BUILT_INS = new Set(
  builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`])
);

export type ImportResolution =
  | "internal-file"
  | "workspace-package"
  | "external-package"
  | "node-built-in"
  | "asset"
  | "unresolved";

export interface ResolutionStats {
  countsByResolution: Partial<Record<ImportResolution, number>>;
  unresolvedRate: number;
}

export interface ModuleResolutionDiagnostic {
  severity: "warning" | "error";
  code: string;
  message: string;
  filePath?: string | undefined;
  line?: number | undefined;
}

export interface ResolvedFileImport extends ExtractedFileImport {
  resolution: ImportResolution;
  resolvedFilePath?: string | undefined;
  workspacePackage?: string | undefined;
  externalPackage?: string | undefined;
}

export interface ResolveFileImportsInput {
  repositoryRoot: string;
  files: Array<Pick<ResolvedFileImport, "filePath">>;
  imports: ExtractedFileImport[];
  /**
   * Workspace discovery result to reuse. When omitted the resolver discovers the
   * workspace itself and reports its diagnostics; when provided, the caller owns them.
   */
  workspace?: WorkspaceDiscoveryResult | undefined;
}

export interface ResolveFileImportsResult {
  imports: ResolvedFileImport[];
  diagnostics: ModuleResolutionDiagnostic[];
  resolutionStats: ResolutionStats;
}

interface ParsedTsConfig {
  path: string;
  directory: string;
  options: ts.CompilerOptions;
  fileNames: Set<string>;
  pathAliasPatterns: readonly string[];
}

interface WorkspacePackage {
  name: string;
  directory: string;
  manifest: PackageManifest;
  rootDir?: string | undefined;
  outDir?: string | undefined;
}

interface ResolutionContext {
  repositoryRoot: string;
  repositoryFiles: Set<string>;
  tsConfigByDirectory: Map<string, ParsedTsConfig>;
  /** The nearest tsconfig that lists each file; files it does not list fall back to their ancestors. */
  tsConfigByIncludedFile: Map<string, ParsedTsConfig>;
  workspacePackagesByName: Map<string, WorkspacePackage>;
  /** Every package.json directory, deepest first, so `#` imports find their owning manifest. */
  packageManifests: Array<{ directory: string; manifest: PackageManifest }>;
  resolutionHost: ts.ModuleResolutionHost;
}

export async function resolveFileImports(
  input: ResolveFileImportsInput
): Promise<ResolveFileImportsResult> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const diagnostics: ModuleResolutionDiagnostic[] = [];
  const repositoryFiles = await discoverRepositoryFiles(repositoryRoot);
  const parseHost = createRestrictedParseConfigHost(repositoryRoot, repositoryFiles, diagnostics);
  const tsConfigs = parseTsConfigs(repositoryRoot, repositoryFiles, parseHost, diagnostics);
  const tsConfigByDirectory = new Map(
    tsConfigs.map((config) => [config.directory, config] as const)
  );
  const workspace = input.workspace ?? (await discoverWorkspace(repositoryRoot, repositoryFiles));
  if (!input.workspace) {
    diagnostics.push(...workspace.diagnostics);
  }

  const workspacePackages = resolveWorkspacePackages(
    repositoryRoot,
    workspace,
    repositoryFiles,
    parseHost,
    diagnostics
  );
  const workspacePackagesByName = new Map<string, WorkspacePackage>();
  for (const workspacePackage of workspacePackages) {
    if (!workspacePackagesByName.has(workspacePackage.name)) {
      workspacePackagesByName.set(workspacePackage.name, workspacePackage);
    }
  }

  const context: ResolutionContext = {
    repositoryRoot,
    repositoryFiles,
    tsConfigByDirectory,
    tsConfigByIncludedFile: indexTsConfigsByIncludedFile(tsConfigByDirectory),
    workspacePackagesByName,
    packageManifests: [...workspace.packages].sort(
      (left, right) =>
        right.directory.length - left.directory.length ||
        compareStrings(left.directory, right.directory)
    ),
    resolutionHost: createRestrictedModuleResolutionHost(
      repositoryRoot,
      repositoryFiles,
      indexDirectories(repositoryFiles),
      diagnostics
    )
  };
  const analysedFilePaths = new Set(input.files.map((file) => file.filePath));

  const candidateImportCount = countCandidateImports(input.imports, context);
  const resolvedImports = input.imports
    .map((importItem) => resolveOneImport(importItem, context, diagnostics))
    .sort(compareResolvedImports);
  diagnostics.push(...findImportsIntoExcludedFiles(resolvedImports, analysedFilePaths));

  const unresolvedCandidates = resolvedImports.filter(
    (item) => item.resolution === "unresolved" && isCandidateInternalImport(item.specifier, context)
  ).length;

  const resolutionStats = buildResolutionStats(
    resolvedImports,
    unresolvedCandidates,
    candidateImportCount
  );

  return {
    imports: resolvedImports,
    diagnostics: dedupeDiagnostics(diagnostics).sort(compareDiagnostics),
    resolutionStats
  };
}

function parseTsConfigs(
  repositoryRoot: string,
  repositoryFiles: Set<string>,
  parseHost: ts.ParseConfigHost,
  diagnostics: ModuleResolutionDiagnostic[]
): ParsedTsConfig[] {
  const tsConfigPaths = [...repositoryFiles]
    .filter(
      (filePath) =>
        path.posix.basename(filePath).startsWith("tsconfig") && filePath.endsWith(".json")
    )
    .sort(compareStrings);
  const parsedConfigs: ParsedTsConfig[] = [];

  for (const tsConfigPath of tsConfigPaths) {
    const parsedConfig = parseTsConfigFile(repositoryRoot, tsConfigPath, parseHost, diagnostics);
    if (parsedConfig) {
      parsedConfigs.push(parsedConfig);
    }
  }

  parsedConfigs.sort((left, right) => compareStrings(left.path, right.path));
  return parsedConfigs;
}

function resolveWorkspacePackages(
  repositoryRoot: string,
  workspace: WorkspaceDiscoveryResult,
  repositoryFiles: Set<string>,
  parseHost: ts.ParseConfigHost,
  diagnostics: ModuleResolutionDiagnostic[]
): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  for (const { directory, manifest } of workspace.packages) {
    if (!manifest.name) {
      continue;
    }

    const tsConfig = findPackageTsConfig(directory, repositoryFiles);
    const parsedTsConfig = tsConfig
      ? parseTsConfigFile(repositoryRoot, tsConfig, parseHost, diagnostics)
      : null;

    packages.push({
      name: manifest.name,
      directory,
      manifest,
      rootDir: parsedTsConfig?.options.rootDir
        ? toPosixPath(parsedTsConfig.options.rootDir)
        : undefined,
      outDir: parsedTsConfig?.options.outDir
        ? toPosixPath(parsedTsConfig.options.outDir)
        : undefined
    });
  }

  packages.sort((left, right) => compareStrings(left.name, right.name));
  return packages;
}

function findPackageTsConfig(
  packageDirectory: string,
  repositoryFiles: Set<string>
): string | undefined {
  const candidates =
    packageDirectory === "."
      ? ["tsconfig.json"]
      : [`${packageDirectory}/tsconfig.json`, `${packageDirectory}/tsconfig.build.json`];
  return candidates.find((candidate) => repositoryFiles.has(candidate));
}

function parseTsConfigFile(
  repositoryRoot: string,
  tsConfigPath: string,
  parseHost: ts.ParseConfigHost,
  diagnostics: ModuleResolutionDiagnostic[]
): ParsedTsConfig | null {
  const absolutePath = path.join(repositoryRoot, tsConfigPath);
  const configFile = ts.readConfigFile(absolutePath, parseHost.readFile);
  if (configFile.error) {
    diagnostics.push(toTsConfigDiagnostic(configFile.error, tsConfigPath, repositoryRoot));
    return null;
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    parseHost,
    path.dirname(absolutePath),
    undefined,
    absolutePath
  );

  const bareExtends = readBareExtendsSpecifiers(configFile.config);
  for (const parseDiagnostic of parsed.errors) {
    if (parseDiagnostic.code === TS_NO_INPUTS_FOUND) {
      continue;
    }

    const diagnostic = toTsConfigDiagnostic(parseDiagnostic, tsConfigPath, repositoryRoot);
    if (isUnresolvedPackageExtends(parseDiagnostic, diagnostic.message, bareExtends)) {
      diagnostics.push({
        ...diagnostic,
        severity: "warning",
        code: "TSCONFIG_EXTENDS_UNRESOLVED_PACKAGE_SKIPPED"
      });
      continue;
    }

    diagnostics.push(diagnostic);
  }

  return {
    path: tsConfigPath,
    directory: toPosixPath(path.posix.dirname(tsConfigPath)),
    options: parsed.options,
    fileNames: new Set(
      parsed.fileNames
        .map((fileName) => toRepositoryRelativePath(repositoryRoot, fileName))
        .filter((fileName): fileName is string => Boolean(fileName))
    ),
    pathAliasPatterns: Object.keys(parsed.options.paths ?? {})
  };
}

function resolveOneImport(
  importItem: ExtractedFileImport,
  context: ResolutionContext,
  diagnostics: ModuleResolutionDiagnostic[]
): ResolvedFileImport {
  if (importItem.specifier.startsWith("node:") || NODE_BUILT_INS.has(importItem.specifier)) {
    return {
      ...importItem,
      resolution: "node-built-in"
    };
  }

  const workspaceMatch = findWorkspacePackageMatch(
    importItem.specifier,
    context.workspacePackagesByName
  );
  if (workspaceMatch) {
    const resolvedFilePath = resolveWorkspaceImportToSourceFile(workspaceMatch, context);
    if (resolvedFilePath) {
      return {
        ...importItem,
        resolution: "workspace-package",
        workspacePackage: workspaceMatch.packageEntry.name,
        resolvedFilePath
      };
    }

    diagnostics.push({
      severity: "warning",
      code: "WORKSPACE_ENTRY_UNMAPPED",
      message: `Could not map "${importItem.specifier}" to a source file for workspace package "${workspaceMatch.packageEntry.name}".`,
      filePath: importItem.filePath,
      line: importItem.line
    });

    return {
      ...importItem,
      resolution: "workspace-package",
      workspacePackage: workspaceMatch.packageEntry.name
    };
  }

  if (isAssetSpecifier(importItem.specifier)) {
    return {
      ...importItem,
      resolution: "asset"
    };
  }

  const fileTsConfig = findNearestTsConfig(importItem.filePath, context);
  const resolvedByTypeScript = resolveWithTypeScript(importItem, context, fileTsConfig?.options);
  if (resolvedByTypeScript) {
    return {
      ...importItem,
      resolution: "internal-file",
      resolvedFilePath: resolvedByTypeScript
    };
  }

  const resolvedByPackageImports = resolvePackageImportsEntry(importItem, context);
  if (resolvedByPackageImports) {
    return {
      ...importItem,
      resolution: "internal-file",
      resolvedFilePath: resolvedByPackageImports
    };
  }

  if (importItem.specifier.startsWith(".") || importItem.specifier.startsWith("/")) {
    return {
      ...importItem,
      resolution: "unresolved"
    };
  }

  if (isBareSpecifier(importItem.specifier)) {
    return {
      ...importItem,
      resolution: "external-package",
      externalPackage: extractPackageName(importItem.specifier)
    };
  }

  return {
    ...importItem,
    resolution: "unresolved"
  };
}

function resolveWithTypeScript(
  importItem: ExtractedFileImport,
  context: ResolutionContext,
  options?: ts.CompilerOptions
): string | null {
  const containingFilePath = path.join(context.repositoryRoot, importItem.filePath);
  const moduleResolution = ts.resolveModuleName(
    importItem.specifier,
    containingFilePath,
    options ?? {
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      module: ts.ModuleKind.NodeNext,
      allowJs: true
    },
    context.resolutionHost
  );

  const resolvedFileName = moduleResolution.resolvedModule?.resolvedFileName;
  if (!resolvedFileName) {
    return null;
  }

  const relativePath = toRepositoryRelativePath(context.repositoryRoot, resolvedFileName);
  if (!relativePath) {
    return null;
  }

  return resolveToKnownSourceFile(relativePath, context.repositoryFiles);
}

/**
 * Fallback for `#` specifiers that TypeScript rejects, such as an `imports` target outside
 * the package (`"#utils": "../utils/index.ts"`). Node forbids those, but bundlers accept them.
 */
function resolvePackageImportsEntry(
  importItem: ExtractedFileImport,
  context: ResolutionContext
): string | null {
  if (!importItem.specifier.startsWith("#")) {
    return null;
  }

  const owner = context.packageManifests.find(
    ({ directory }) =>
      directory === "." ||
      importItem.filePath === directory ||
      importItem.filePath.startsWith(`${directory}/`)
  );
  const imports = owner?.manifest.imports;
  if (!owner || !imports || typeof imports !== "object") {
    return null;
  }

  // `imports` keys look like `#name`; exports-style matching expects `./name`.
  const asExports = Object.fromEntries(
    Object.entries(imports).map(([key, value]) => [key.replace(/^#/u, "./"), value])
  );
  const target = resolveExportsTarget(asExports, importItem.specifier.slice(1));
  if (!target || target.startsWith("#") || !target.startsWith(".")) {
    return null;
  }

  const candidate = path.posix.normalize(
    owner.directory === "." ? target : `${owner.directory}/${target}`
  );
  return resolveToKnownSourceFile(candidate, context.repositoryFiles);
}

function resolveWorkspaceImportToSourceFile(
  workspaceMatch: {
    packageEntry: WorkspacePackage;
    subpath: string;
  },
  context: ResolutionContext
): string | null {
  const packageDirectory = workspaceMatch.packageEntry.directory;
  const candidateEntries = collectWorkspaceEntryCandidates(
    workspaceMatch.packageEntry,
    workspaceMatch.subpath
  );

  for (const entry of candidateEntries) {
    const mappedSourcePath = mapWorkspaceEntryToSourcePath(entry, workspaceMatch.packageEntry);
    if (!mappedSourcePath) {
      continue;
    }

    const packageRelativePath = normalizeSubpath(mappedSourcePath);
    if (!packageRelativePath) {
      continue;
    }

    const candidateFilePath =
      packageDirectory === "." ? packageRelativePath : `${packageDirectory}/${packageRelativePath}`;
    const resolved = resolveToKnownSourceFile(candidateFilePath, context.repositoryFiles);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function collectWorkspaceEntryCandidates(
  packageEntry: WorkspacePackage,
  subpath: string
): string[] {
  const candidates: string[] = [];
  const exportsTarget = resolveExportsTarget(packageEntry.manifest.exports, subpath);
  if (exportsTarget) {
    candidates.push(exportsTarget);
  }

  const manifest = packageEntry.manifest;
  if (!subpath) {
    for (const field of [manifest.main, manifest.module, manifest.types, manifest.source]) {
      if (field) {
        candidates.push(field);
      }
    }
  } else if (manifest.source) {
    const sourceRoot = normalizeSubpath(path.posix.dirname(manifest.source));
    if (sourceRoot) {
      candidates.push(`${sourceRoot}/${subpath}`);
    }
  }

  if (!subpath) {
    for (const defaultEntry of [
      "src/index.ts",
      "src/index.tsx",
      "src/index.mts",
      "src/index.cts",
      "index.ts",
      "index.tsx",
      "index.mts",
      "index.cts"
    ]) {
      candidates.push(defaultEntry);
    }
  } else {
    for (const extension of SOURCE_EXTENSIONS) {
      candidates.push(`src/${subpath}${extension}`);
      candidates.push(`${subpath}${extension}`);
      candidates.push(`src/${subpath}/index${extension}`);
      candidates.push(`${subpath}/index${extension}`);
    }
  }

  return dedupe(
    candidates.map(normalizeSubpath).filter((value): value is string => Boolean(value))
  );
}

function mapWorkspaceEntryToSourcePath(
  entry: string,
  packageEntry: WorkspacePackage
): string | null {
  const normalizedEntry = normalizeSubpath(entry);
  if (!normalizedEntry) {
    return null;
  }

  if (packageEntry.outDir && packageEntry.rootDir) {
    const normalizedOutDir = normalizeSubpath(packageEntry.outDir);
    const normalizedRootDir = normalizeSubpath(packageEntry.rootDir);
    if (
      normalizedOutDir &&
      normalizedRootDir &&
      (normalizedEntry === normalizedOutDir || normalizedEntry.startsWith(`${normalizedOutDir}/`))
    ) {
      return `${normalizedRootDir}${normalizedEntry.slice(normalizedOutDir.length)}`;
    }
  }

  return normalizedEntry;
}

function resolveExportsTarget(exportsField: unknown, subpath: string): string | null {
  if (typeof exportsField === "string") {
    return subpath ? null : exportsField;
  }

  if (!exportsField || typeof exportsField !== "object") {
    return null;
  }

  const exportsRecord = exportsField as Record<string, unknown>;
  const subpathKey = subpath ? `./${subpath}` : ".";
  const direct = resolveExportsValue(exportsRecord[subpathKey]);
  if (direct) {
    return direct;
  }

  if (!subpath) {
    return resolveExportsValue(exportsRecord["."]);
  }

  for (const [key, value] of Object.entries(exportsRecord)) {
    if (!key.includes("*")) {
      continue;
    }

    const [prefix, suffix] = key.split("*");
    if (prefix === undefined || suffix === undefined) {
      continue;
    }

    const requestedSubpath = `./${subpath}`;
    if (!requestedSubpath.startsWith(prefix) || !requestedSubpath.endsWith(suffix)) {
      continue;
    }

    const wildcard = requestedSubpath.slice(prefix.length, requestedSubpath.length - suffix.length);
    const resolved = resolveExportsValue(value);
    if (!resolved) {
      continue;
    }

    return resolved.replace("*", wildcard);
  }

  return null;
}

function resolveExportsValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const condition of ["types", "import", "default", "require"]) {
    const conditionValue = record[condition];
    if (typeof conditionValue === "string") {
      return conditionValue;
    }
  }

  for (const nestedValue of Object.values(record)) {
    const nested = resolveExportsValue(nestedValue);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function buildResolutionStats(
  imports: ResolvedFileImport[],
  unresolvedCandidates: number,
  candidateImportCount: number
): ResolutionStats {
  const countsByResolution: Partial<Record<ImportResolution, number>> = {};
  for (const importItem of imports) {
    countsByResolution[importItem.resolution] =
      (countsByResolution[importItem.resolution] ?? 0) + 1;
  }

  return {
    countsByResolution,
    unresolvedRate: candidateImportCount === 0 ? 0 : unresolvedCandidates / candidateImportCount
  };
}

function countCandidateImports(imports: ExtractedFileImport[], context: ResolutionContext): number {
  return imports.filter((importItem) => isCandidateInternalImport(importItem.specifier, context))
    .length;
}

function isCandidateInternalImport(specifier: string, context: ResolutionContext): boolean {
  if (isAssetSpecifier(specifier)) {
    return false;
  }

  // `#` specifiers are the package's own `imports` map, so they are internal by definition.
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) {
    return true;
  }

  if (findWorkspacePackageMatch(specifier, context.workspacePackagesByName)) {
    return true;
  }

  if (!isBareSpecifier(specifier)) {
    return false;
  }

  for (const config of context.tsConfigByDirectory.values()) {
    if (config.pathAliasPatterns.some((pattern) => pathAliasMatchesSpecifier(pattern, specifier))) {
      return true;
    }
  }

  return false;
}

function findWorkspacePackageMatch(
  specifier: string,
  workspacePackagesByName: Map<string, WorkspacePackage>
): { packageEntry: WorkspacePackage; subpath: string } | null {
  const packageName = extractPackageName(specifier);
  const packageEntry = workspacePackagesByName.get(packageName);
  if (!packageEntry) {
    return null;
  }

  const subpath = normalizeSubpath(specifier.slice(packageName.length));
  return {
    packageEntry,
    subpath: subpath ?? ""
  };
}

function extractPackageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    const segments = specifier.split("/");
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : specifier;
  }

  const [first] = specifier.split("/");
  return first ?? specifier;
}

function pathAliasMatchesSpecifier(pathAliasPattern: string, specifier: string): boolean {
  if (!pathAliasPattern.includes("*")) {
    return specifier === pathAliasPattern;
  }

  const [prefix, suffix] = pathAliasPattern.split("*");
  if (prefix === undefined || suffix === undefined) {
    return false;
  }

  return specifier.startsWith(prefix) && specifier.endsWith(suffix);
}

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("#");
}

function indexTsConfigsByIncludedFile(
  tsConfigByDirectory: Map<string, ParsedTsConfig>
): Map<string, ParsedTsConfig> {
  const configByFile = new Map<string, ParsedTsConfig>();
  for (const config of tsConfigByDirectory.values()) {
    for (const fileName of config.fileNames) {
      const existing = configByFile.get(fileName);
      if (!existing || config.directory.length > existing.directory.length) {
        configByFile.set(fileName, config);
      }
    }
  }

  return configByFile;
}

function findNearestTsConfig(filePath: string, context: ResolutionContext): ParsedTsConfig | null {
  const included = context.tsConfigByIncludedFile.get(filePath);
  if (included) {
    return included;
  }

  const directories = toPathSegments(path.posix.dirname(filePath));
  for (let segmentCount = directories.length; segmentCount >= 0; segmentCount -= 1) {
    const candidateDirectory =
      segmentCount === 0 ? "." : directories.slice(0, segmentCount).join("/");
    const found = context.tsConfigByDirectory.get(candidateDirectory);
    if (found) {
      return found;
    }
  }

  return null;
}

function createRestrictedParseConfigHost(
  repositoryRoot: string,
  repositoryFiles: Set<string>,
  diagnostics: ModuleResolutionDiagnostic[]
): ts.ParseConfigHost {
  return {
    useCaseSensitiveFileNames: true,
    readDirectory: (rootDir, extensions) => {
      const relativeRoot = toRepositoryRelativePath(repositoryRoot, rootDir);
      if (relativeRoot === null) {
        return [];
      }

      const prefix = relativeRoot ? `${relativeRoot}/` : "";
      const extensionSet = new Set(extensions ?? []);
      const filePaths = [...repositoryFiles]
        .filter((filePath) => filePath.startsWith(prefix))
        .filter((filePath) => {
          if (extensionSet.size === 0) {
            return true;
          }

          return extensionSet.has(path.posix.extname(filePath));
        })
        .map((filePath) => path.join(repositoryRoot, filePath))
        .sort((left, right) => compareStrings(toCanonicalPath(left), toCanonicalPath(right)));

      return filePaths;
    },
    fileExists: (fileName) =>
      fileExistsWithinRepository(
        repositoryRoot,
        repositoryFiles,
        toRepositoryRelativePath(repositoryRoot, fileName)
      ),
    readFile: (fileName) =>
      readRepositoryFile(repositoryRoot, repositoryFiles, fileName, diagnostics),
    trace: () => undefined
  };
}

function readRepositoryFile(
  repositoryRoot: string,
  repositoryFiles: Set<string>,
  fileName: string,
  diagnostics: ModuleResolutionDiagnostic[]
): string | undefined {
  const relativeFilePath = toRepositoryRelativePath(repositoryRoot, fileName);
  if (!fileExistsWithinRepository(repositoryRoot, repositoryFiles, relativeFilePath)) {
    return undefined;
  }

  // `ts.sys.readFile` returns undefined instead of throwing, for example on a permission error.
  const content = ts.sys.readFile(path.join(repositoryRoot, relativeFilePath ?? ""));
  if (content === undefined) {
    // The message omits OS error text, which varies by host and would change the hashed snapshot.
    diagnostics.push({
      severity: "warning",
      code: "FILE_READ_FAILED",
      message: `Could not read "${relativeFilePath ?? ""}"; it is ignored for module resolution.`,
      filePath: relativeFilePath ?? undefined
    });
  }

  return content;
}

/** Child directory names by repo-relative directory ("" is the root), so directory queries need no file scan. */
type DirectoryIndex = Map<string, Set<string>>;

function indexDirectories(repositoryFiles: Set<string>): DirectoryIndex {
  const index: DirectoryIndex = new Map([["", new Set<string>()]]);
  for (const filePath of repositoryFiles) {
    const segments = filePath.split("/").slice(0, -1);
    let parent = "";
    for (const segment of segments) {
      index.get(parent)?.add(segment);
      const directory = parent ? `${parent}/${segment}` : segment;
      if (!index.has(directory)) {
        index.set(directory, new Set<string>());
      }

      parent = directory;
    }
  }

  return index;
}

function createRestrictedModuleResolutionHost(
  repositoryRoot: string,
  repositoryFiles: Set<string>,
  directoryIndex: DirectoryIndex,
  diagnostics: ModuleResolutionDiagnostic[]
): ts.ModuleResolutionHost {
  return {
    fileExists(fileName) {
      const relativePath = toRepositoryRelativePath(repositoryRoot, fileName);
      return fileExistsWithinRepository(repositoryRoot, repositoryFiles, relativePath);
    },
    readFile: (fileName) =>
      readRepositoryFile(repositoryRoot, repositoryFiles, fileName, diagnostics),
    directoryExists(directoryName) {
      const relativeDirectory = toRepositoryRelativePath(repositoryRoot, directoryName);
      return relativeDirectory !== null && directoryIndex.has(relativeDirectory);
    },
    getDirectories(directoryName) {
      const relativeDirectory = toRepositoryRelativePath(repositoryRoot, directoryName);
      if (
        !relativeDirectory &&
        toPosixPath(path.resolve(directoryName)) !== toPosixPath(repositoryRoot)
      ) {
        return [];
      }

      return [...(directoryIndex.get(relativeDirectory ?? "") ?? [])]
        .map((segment) => path.join(directoryName, segment))
        .sort();
    },
    realpath(fileName) {
      const relativePath = toRepositoryRelativePath(repositoryRoot, fileName);
      if (!relativePath) {
        return toPosixPath(path.resolve(fileName));
      }

      return path.join(repositoryRoot, relativePath);
    }
  };
}

function resolveToKnownSourceFile(filePath: string, repositoryFiles: Set<string>): string | null {
  const normalized = normalizeSubpath(filePath);
  if (!normalized) {
    return null;
  }

  const directMatch = repositoryFiles.has(normalized) ? normalized : null;
  if (directMatch && SOURCE_EXTENSIONS.some((extension) => normalized.endsWith(extension))) {
    return directMatch;
  }

  for (const extension of COMPILED_EXTENSIONS) {
    if (!normalized.endsWith(extension)) {
      continue;
    }

    const withoutExtension = normalized.slice(0, -extension.length);
    for (const sourceExtension of SOURCE_EXTENSIONS) {
      const candidate = `${withoutExtension}${sourceExtension}`;
      if (repositoryFiles.has(candidate)) {
        return candidate;
      }
    }
  }

  const suffixWithoutExtension = normalized.replace(/\.[^.]+$/u, "");
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `${suffixWithoutExtension}${extension}`;
    if (repositoryFiles.has(candidate)) {
      return candidate;
    }
  }

  for (const extension of SOURCE_EXTENSIONS) {
    const asIndex = `${normalized}/index${extension}`;
    if (repositoryFiles.has(asIndex)) {
      return asIndex;
    }
  }

  return null;
}

function fileExistsWithinRepository(
  repositoryRoot: string,
  repositoryFiles: Set<string>,
  relativeFilePath: string | null
): boolean {
  if (!relativeFilePath) {
    return false;
  }

  return repositoryFiles.has(relativeFilePath);
}

function toRepositoryRelativePath(repositoryRoot: string, candidatePath: string): string | null {
  const resolvedPath = path.resolve(candidatePath);
  if (!isInsideRepositoryRoot(repositoryRoot, resolvedPath)) {
    return null;
  }

  const relativePath = toPosixPath(path.relative(repositoryRoot, resolvedPath));
  if (!relativePath || relativePath === ".") {
    return "";
  }

  if (relativePath.startsWith("../") || path.posix.isAbsolute(relativePath)) {
    return null;
  }

  if (relativePath.includes("/node_modules/") || relativePath.endsWith("/node_modules")) {
    return null;
  }

  return relativePath;
}

function normalizeSubpath(filePath: string): string | null {
  const normalized = toPosixPath(path.posix.normalize(filePath)).replace(/^\.\/+/u, "");
  if (!normalized || normalized === "." || normalized.startsWith("../")) {
    return null;
  }

  return normalized;
}

function isInsideRepositoryRoot(repositoryRoot: string, candidatePath: string): boolean {
  const relativePath = path.relative(repositoryRoot, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

function toPathSegments(directory: string): string[] {
  if (!directory || directory === ".") {
    return [];
  }

  return directory.split("/").filter(Boolean);
}

function compareResolvedImports(left: ResolvedFileImport, right: ResolvedFileImport): number {
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

function compareDiagnostics(
  left: ModuleResolutionDiagnostic,
  right: ModuleResolutionDiagnostic
): number {
  if ((left.filePath ?? "") !== (right.filePath ?? "")) {
    return compareStrings(left.filePath ?? "", right.filePath ?? "");
  }

  if ((left.line ?? 0) !== (right.line ?? 0)) {
    return (left.line ?? 0) - (right.line ?? 0);
  }

  if (left.code !== right.code) {
    return compareStrings(left.code, right.code);
  }

  return compareStrings(left.message, right.message);
}

function toTsConfigDiagnostic(
  diagnostic: ts.Diagnostic,
  filePath: string,
  repositoryRoot: string
): ModuleResolutionDiagnostic {
  return {
    severity: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
    code: "TSCONFIG_PARSE_ERROR",
    message: toRepositoryRelativeMessage(
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      repositoryRoot
    ),
    filePath
  };
}

/** Keeps host-specific absolute paths out of diagnostics, which are hashed and stored. */
function toRepositoryRelativeMessage(message: string, repositoryRoot: string): string {
  const root = toPosixPath(path.resolve(repositoryRoot));
  return message
    .replaceAll(`${root}/`, "")
    .replaceAll(root, ".")
    .replaceAll(/'((?:[A-Za-z]:)?\/[^']*)'/gu, "'<outside-repository>'");
}

/** Bare specifiers in a tsconfig `extends` value, for example `@tsconfig/node20/tsconfig.json`. */
function readBareExtendsSpecifiers(config: unknown): string[] {
  const extendsValue = (config as { extends?: unknown } | null)?.extends;
  const values = Array.isArray(extendsValue) ? extendsValue : [extendsValue];
  return values.filter(
    (value): value is string =>
      typeof value === "string" &&
      !value.startsWith(".") &&
      !path.posix.isAbsolute(value) &&
      !path.win32.isAbsolute(value)
  );
}

function isUnresolvedPackageExtends(
  diagnostic: ts.Diagnostic,
  message: string,
  bareExtends: readonly string[]
): boolean {
  return (
    diagnostic.code === TS_FILE_NOT_FOUND &&
    bareExtends.some((specifier) => message.includes(`'${specifier}'`))
  );
}

const ASSET_EXTENSIONS = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".styl",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".txt",
  ".md",
  ".html",
  ".graphql",
  ".gql",
  ".wasm",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".webm",
  ".wav",
  ".ogg",
  ".pdf"
]);

/** A relative import of a non-code file, such as `./styles.css`, with an optional `?query` or `#hash`. */
function isAssetSpecifier(specifier: string): boolean {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return false;
  }

  const pathPart = specifier.replace(/[?#].*$/u, "");
  return ASSET_EXTENSIONS.has(path.posix.extname(pathPart).toLowerCase());
}

/** Imports that resolve to a real file the analysis left out would otherwise vanish without a trace. */
function findImportsIntoExcludedFiles(
  resolvedImports: ResolvedFileImport[],
  analysedFilePaths: ReadonlySet<string>
): ModuleResolutionDiagnostic[] {
  return resolvedImports
    .filter(
      (item) => item.resolvedFilePath !== undefined && !analysedFilePaths.has(item.resolvedFilePath)
    )
    .map((item) => ({
      severity: "warning",
      code: "IMPORT_TARGET_EXCLUDED",
      message: `Import "${item.specifier}" resolves to "${item.resolvedFilePath ?? ""}", which is excluded from analysis (ignored, generated, oversized or a declaration file); no dependency is recorded.`,
      filePath: item.filePath,
      line: item.line
    }));
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeDiagnostics(
  diagnostics: ModuleResolutionDiagnostic[]
): ModuleResolutionDiagnostic[] {
  const seen = new Set<string>();
  const deduped: ModuleResolutionDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.severity,
      diagnostic.code,
      diagnostic.filePath ?? "",
      diagnostic.line ?? 0,
      diagnostic.message
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(diagnostic);
  }

  return deduped;
}

function toCanonicalPath(fileName: string): string {
  return toPosixPath(fileName).toLowerCase();
}
