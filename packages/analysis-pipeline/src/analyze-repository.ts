import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  buildArchitectureSnapshot,
  mapFilesToComponentHierarchy,
  type SnapshotBuilderFileInput
} from "@archmind/architecture-engine";
import {
  LocalFsSourceProvider,
  PARSER_VERSION,
  discoverWorkspace,
  extractImportsAndSymbols,
  resolveFileImports
} from "@archmind/code-analysis";
import {
  archmindConfigSchema,
  type AnalysisConfig,
  type ArchitectureSnapshotDocument
} from "@archmind/contracts";
import { canonicalJson } from "@archmind/domain";

const execFileAsync = promisify(execFile);

const ENGINE_VERSION = "0.1.0";

export interface AnalyzeRepositoryInput {
  repositoryRoot: string;
}

export interface AnalyzeRepositoryResult {
  snapshot: ArchitectureSnapshotDocument;
}

/**
 * Runs the full local analysis: discover sources, extract, resolve, map to
 * components and build the snapshot. Shared by the CLI and, from M4, the worker.
 */
export async function analyzeRepository(
  input: AnalyzeRepositoryInput
): Promise<AnalyzeRepositoryResult> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const { analysisConfig } = await loadArchmindConfig(repositoryRoot);
  const sourceProviderResult = await new LocalFsSourceProvider().discover({
    repositoryRoot,
    analysisConfig
  });
  const workspace = await discoverWorkspace(repositoryRoot);
  const extracted = await extractImportsAndSymbols({
    repositoryRoot,
    files: sourceProviderResult.files
  });
  const resolved = await resolveFileImports({
    repositoryRoot,
    files: sourceProviderResult.files.map((file) => ({ filePath: file.path })),
    imports: extracted.imports,
    workspace
  });

  const ownership = mapFilesToComponentHierarchy({
    analysisConfig,
    filePaths: sourceProviderResult.files.map((file) => file.path),
    packageDirectories: workspace.packages.map((workspacePackage) => workspacePackage.directory)
  });
  const workspacePackageComponents: Record<string, string> = {};
  for (const { directory, manifest } of workspace.packages) {
    if (manifest.name) {
      workspacePackageComponents[manifest.name] = `package:${directory}`;
    }
  }

  const fileLocByPath = await loadFileLocMap(
    repositoryRoot,
    sourceProviderResult.files.map((file) => file.path)
  );

  const gitMetadata = await readGitSourceMetadata(repositoryRoot);
  const snapshot = buildArchitectureSnapshot({
    engineVersion: ENGINE_VERSION,
    parserVersion: PARSER_VERSION,
    analysisConfigHash: sha256Hex(canonicalJson(analysisConfig)),
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
      ...workspace.diagnostics,
      ...extracted.diagnostics,
      ...resolved.diagnostics
    ],
    workspacePackageComponents
  });

  return { snapshot };
}

async function loadArchmindConfig(
  repositoryRoot: string
): Promise<{ analysisConfig: AnalysisConfig }> {
  const configPath = path.join(repositoryRoot, "archmind.config.json");
  let configContent: string;
  try {
    configContent = await readFile(configPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return { analysisConfig: archmindConfigSchema.parse({}).analysis };
    }

    throw error;
  }

  let configJson: unknown;
  try {
    configJson = JSON.parse(configContent);
  } catch (error) {
    throw new Error(`Invalid JSON in "archmind.config.json": ${toErrorMessage(error)}`);
  }

  return { analysisConfig: archmindConfigSchema.parse(configJson).analysis };
}

async function loadFileLocMap(
  repositoryRoot: string,
  filePaths: string[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (const filePath of filePaths) {
    const content = await readFile(path.join(repositoryRoot, filePath), "utf8");
    result.set(filePath, countLoc(content));
  }

  return result;
}

function countLoc(content: string): number {
  return content.length === 0 ? 0 : content.split(/\r?\n/u).length;
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

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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
  return error instanceof Error ? error.message : String(error);
}
