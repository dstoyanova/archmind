import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ENGINE_VERSION,
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

import { readGitSourceMetadata } from "./git-source-metadata.js";

export interface AnalyzeRepositoryInput {
  repositoryRoot: string;
}

export interface AnalyzeRepositoryResult {
  snapshot: ArchitectureSnapshotDocument;
  /** Non-fatal problems outside the snapshot, such as git metadata that could not be read. */
  warnings: string[];
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
    if (manifest.name && !Object.hasOwn(workspacePackageComponents, manifest.name)) {
      workspacePackageComponents[manifest.name] = `package:${directory}`;
    }
  }

  const git = await readGitSourceMetadata(repositoryRoot);
  const snapshot = buildArchitectureSnapshot({
    engineVersion: ENGINE_VERSION,
    parserVersion: PARSER_VERSION,
    analysisConfigHash: sha256Hex(canonicalJson(analysisConfig)),
    source: {
      kind: "local",
      sourceHash: sourceProviderResult.sourceHash,
      ...git.metadata
    },
    components: ownership.components,
    ownership: ownership.ownership,
    files: sourceProviderResult.files.map<SnapshotBuilderFileInput>((file) => ({
      path: file.path,
      role: file.role,
      loc: file.loc
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
      ...ownership.diagnostics,
      ...sourceProviderResult.diagnostics,
      ...workspace.diagnostics,
      ...extracted.diagnostics,
      ...resolved.diagnostics
    ],
    workspacePackageComponents
  });

  return { snapshot, warnings: git.warnings };
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

  const parsed = archmindConfigSchema.safeParse(configJson);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `- ${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`
    );
    throw new Error(`Invalid "archmind.config.json":\n${issues.join("\n")}`);
  }

  return { analysisConfig: parsed.data.analysis };
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
