import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import {
  buildArchitectureSnapshot,
  mapFilesToComponentHierarchy,
  type SnapshotBuilderFileInput
} from "@archmind/architecture-engine";
import {
  LocalFsSourceProvider,
  extractImportsAndSymbols,
  resolveFileImports
} from "@archmind/code-analysis";
import {
  archmindConfigSchema,
  type AnalysisConfig,
  type ArchitectureSnapshotDocument
} from "@archmind/contracts";
import { minimatch } from "minimatch";
import ts from "typescript";

const execFileAsync = promisify(execFile);

const ENGINE_VERSION = "0.1.0";
const EXCLUDED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next"
]);

export type AnalyzeOutputFormat = "snapshot" | "summary";

export interface AnalyzeRepositoryInput {
  repositoryRoot: string;
}

export interface AnalyzeRepositoryResult {
  snapshot: ArchitectureSnapshotDocument;
}

export interface AnalyzeCommandInput {
  repositoryPath: string;
  outputPath: string;
  format: AnalyzeOutputFormat;
}

export async function analyzeRepository(
  input: AnalyzeRepositoryInput
): Promise<AnalyzeRepositoryResult> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const { analysisConfig } = await loadArchmindConfig(repositoryRoot);
  const sourceProviderResult = await new LocalFsSourceProvider().discover({
    repositoryRoot,
    analysisConfig
  });
  const extracted = await extractImportsAndSymbols({
    repositoryRoot,
    files: sourceProviderResult.files
  });
  const resolved = await resolveFileImports({
    repositoryRoot,
    files: sourceProviderResult.files.map((file) => ({ filePath: file.path })),
    imports: extracted.imports
  });

  const packageDirectories = await discoverWorkspacePackageDirectories(repositoryRoot);
  const ownership = mapFilesToComponentHierarchy({
    analysisConfig,
    filePaths: sourceProviderResult.files.map((file) => file.path),
    packageDirectories
  });
  const workspacePackageComponents = await mapWorkspacePackageNamesToComponents(
    repositoryRoot,
    packageDirectories
  );
  const fileLocByPath = await loadFileLocMap(
    repositoryRoot,
    sourceProviderResult.files.map((file) => file.path)
  );

  const gitMetadata = await readGitSourceMetadata(repositoryRoot);
  const snapshot = buildArchitectureSnapshot({
    engineVersion: ENGINE_VERSION,
    parserVersion: ts.version,
    analysisConfigHash: sha256Hex(JSON.stringify(normalizeForHash(analysisConfig))),
    source: {
      kind: "local",
      sourceHash: sourceProviderResult.sourceHash,
      ...gitMetadata
    },
    components: ownership.components,
    ownership: ownership.ownership,
    files: sourceProviderResult.files.map<SnapshotBuilderFileInput>((file) => ({
      path: file.path,
      role: file.role,
      loc: fileLocByPath.get(file.path) ?? 0
    })),
    fileImports: resolved.imports.map((fileImport) => ({
      filePath: fileImport.filePath,
      specifier: fileImport.specifier,
      kind: fileImport.kind,
      line: fileImport.line,
      column: fileImport.column,
      resolution: fileImport.resolution,
      resolvedFilePath: fileImport.resolvedFilePath,
      workspacePackage: fileImport.workspacePackage,
      externalPackage: fileImport.externalPackage
    })),
    symbols: extracted.symbols.map((symbol) => ({
      filePath: symbol.filePath,
      name: symbol.name,
      kind: symbol.kind,
      line: symbol.line,
      column: symbol.column
    })),
    resolutionStats: resolved.resolutionStats,
    diagnostics: [
      ...sourceProviderResult.diagnostics,
      ...extracted.diagnostics,
      ...resolved.diagnostics
    ],
    workspacePackageComponents
  });

  return { snapshot };
}

export async function runAnalyzeCommand(input: AnalyzeCommandInput): Promise<string | null> {
  const repositoryRoot = path.resolve(input.repositoryPath);
  const outputPath = path.resolve(input.outputPath);
  const result = await analyzeRepository({
    repositoryRoot
  });

  await ensureDirectoryForFile(outputPath);
  await writeFile(outputPath, JSON.stringify(result.snapshot, null, 2) + "\n", "utf8");

  if (input.format === "summary") {
    return formatSnapshotSummary(result.snapshot);
  }

  return null;
}

export function formatSnapshotSummary(snapshot: ArchitectureSnapshotDocument): string {
  const errorCount = snapshot.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error"
  ).length;
  const warningCount = snapshot.diagnostics.length - errorCount;
  const runtimeCycles = snapshot.cycles.filter((cycle) => !cycle.typeOnly).length;
  const typeOnlyCycles = snapshot.cycles.length - runtimeCycles;
  const resolutionEntries = Object.entries(snapshot.resolutionStats.countsByResolution)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resolution, count]) => `  - ${resolution}: ${count}`)
    .join("\n");

  return [
    `Snapshot written.`,
    `- components: ${snapshot.components.length}`,
    `- dependencies: ${snapshot.dependencies.length}`,
    `- cycles: ${snapshot.cycles.length} (runtime: ${runtimeCycles}, type-only: ${typeOnlyCycles})`,
    `- resolution unresolved rate: ${(snapshot.resolutionStats.unresolvedRate * 100).toFixed(2)}%`,
    `- diagnostics: ${snapshot.diagnostics.length} (errors: ${errorCount}, warnings: ${warningCount})`,
    `- resolution statistics:`,
    resolutionEntries || "  - none"
  ].join("\n");
}

async function loadArchmindConfig(
  repositoryRoot: string
): Promise<{ analysisConfig: AnalysisConfig }> {
  const configPath = path.join(repositoryRoot, "archmind.config.json");
  let configContent: string | null = null;
  try {
    configContent = await readFile(configPath, "utf8");
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  if (configContent === null) {
    return {
      analysisConfig: archmindConfigSchema.parse({}).analysis
    };
  }

  let configJson: unknown;
  try {
    configJson = JSON.parse(configContent);
  } catch (error) {
    throw new Error(
      `Invalid JSON in "archmind.config.json": ${toErrorMessage(error)}`
    );
  }

  const parsed = archmindConfigSchema.parse(configJson);
  return {
    analysisConfig: parsed.analysis
  };
}

async function discoverWorkspacePackageDirectories(repositoryRoot: string): Promise<string[]> {
  const packageDirectories = await discoverPackageJsonDirectories(repositoryRoot);
  const workspacePatterns = await loadWorkspacePatterns(repositoryRoot);

  const selectedDirectories =
    workspacePatterns.length === 0
      ? packageDirectories
      : packageDirectories.filter((directory) => {
          if (directory === ".") {
            return true;
          }

          return workspacePatterns.some((pattern) =>
            minimatch(directory, pattern, { dot: true })
          );
        });

  return [...new Set(selectedDirectories)].sort(
    (left, right) => left.length - right.length || left.localeCompare(right)
  );
}

async function discoverPackageJsonDirectories(repositoryRoot: string): Promise<string[]> {
  const directories = new Set<string>();

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toPosixPath(path.relative(repositoryRoot, absolutePath));
      if (!relativePath) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }

        await visit(absolutePath);
        continue;
      }

      if (entry.isFile() && entry.name === "package.json") {
        directories.add(toPosixPath(path.posix.dirname(relativePath)));
      }
    }
  };

  await visit(repositoryRoot);
  return [...directories].sort((left, right) => left.localeCompare(right));
}

async function loadWorkspacePatterns(repositoryRoot: string): Promise<string[]> {
  const patterns = new Set<string>();

  const rootManifest = await readJsonFile<{
    workspaces?: string[] | { packages?: string[] | undefined } | undefined;
  }>(path.join(repositoryRoot, "package.json"));
  const workspaces = rootManifest?.workspaces;
  if (Array.isArray(workspaces)) {
    for (const pattern of workspaces) {
      if (typeof pattern === "string" && pattern.length > 0) {
        patterns.add(pattern);
      }
    }
  } else if (workspaces && Array.isArray(workspaces.packages)) {
    for (const pattern of workspaces.packages) {
      if (typeof pattern === "string" && pattern.length > 0) {
        patterns.add(pattern);
      }
    }
  }

  const pnpmWorkspace = await readTextFile(path.join(repositoryRoot, "pnpm-workspace.yaml"));
  if (pnpmWorkspace) {
    for (const line of pnpmWorkspace.split(/\r?\n/u)) {
      const match = /^\s*-\s*(.+)\s*$/u.exec(line);
      if (!match?.[1]) {
        continue;
      }

      const value = match[1].trim().replace(/^["']|["']$/gu, "");
      if (value.length > 0) {
        patterns.add(value);
      }
    }
  }

  return [...patterns].sort((left, right) => left.localeCompare(right));
}

async function mapWorkspacePackageNamesToComponents(
  repositoryRoot: string,
  packageDirectories: string[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const packageDirectory of packageDirectories) {
    const packageJsonPath =
      packageDirectory === "."
        ? path.join(repositoryRoot, "package.json")
        : path.join(repositoryRoot, packageDirectory, "package.json");
    const packageJson = await readJsonFile<{ name?: string | undefined }>(packageJsonPath);
    if (!packageJson?.name) {
      continue;
    }

    result[packageJson.name] = `package:${packageDirectory}`;
  }

  return result;
}

async function loadFileLocMap(
  repositoryRoot: string,
  filePaths: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (const filePath of filePaths) {
    const absolutePath = path.join(repositoryRoot, filePath);
    const content = await readFile(absolutePath, "utf8");
    result.set(filePath, countLoc(content));
  }

  return result;
}

function countLoc(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  return content.split(/\r?\n/u).length;
}

async function readGitSourceMetadata(repositoryRoot: string): Promise<{
  commitSha?: string | undefined;
  branch?: string | undefined;
  commitTimestamp?: string | undefined;
  workingTreeDirty?: boolean | undefined;
}> {
  const [commitSha, branch, commitTimestamp, status] = await Promise.all([
    runGitCommand(repositoryRoot, ["rev-parse", "HEAD"]),
    runGitCommand(repositoryRoot, ["rev-parse", "--abbrev-ref", "HEAD"]),
    runGitCommand(repositoryRoot, ["show", "-s", "--format=%cI", "HEAD"]),
    runGitCommand(repositoryRoot, ["status", "--porcelain"])
  ]);

  if (!commitSha || !branch || !commitTimestamp) {
    return {};
  }

  return {
    commitSha,
    branch,
    commitTimestamp,
    workingTreeDirty: status !== ""
  };
}

async function runGitCommand(
  repositoryRoot: string,
  args: string[]
): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", ["--no-pager", ...args], {
      cwd: repositoryRoot,
      timeout: 2000
    });
    return result.stdout.trim();
  } catch {
    return undefined;
  }
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  const content = await readTextFile(filePath);
  if (content === null) {
    return null;
  }

  return JSON.parse(content) as T;
}

function normalizeForHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeForHash(entry));
  }

  if (value !== null && typeof value === "object") {
    const sortedEntries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right)
    );
    return Object.fromEntries(
      sortedEntries.map(([key, entry]) => [key, normalizeForHash(entry)])
    );
  }

  return value;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toPosixPath(filePath: string): string {
  const normalized = filePath.replaceAll(path.sep, path.posix.sep);
  return normalized === "" ? "." : normalized;
}

function isNodeError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function ensureDirectoryForFile(filePath: string): Promise<void> {
  const targetDirectory = path.dirname(filePath);
  await mkdir(targetDirectory, { recursive: true });
}
