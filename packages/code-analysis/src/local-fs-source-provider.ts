import { createHash, type BinaryLike } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { AnalysisConfig } from "@archmind/contracts";
import { canonicalJson, compareStrings } from "@archmind/domain";
import ignore, { type Ignore } from "ignore";
import { minimatch } from "minimatch";

import {
  PACKAGE_MANIFEST_FILE_NAME,
  isExcludedDirectory,
  isRepositoryOrPackageRoot
} from "./repository-files.js";
import {
  DEFAULT_SOURCE_PROVIDER_LIMITS,
  type DiscoveredSourceFile,
  type FileRole,
  type SourceProvider,
  type SourceProviderDiagnostic,
  type SourceProviderInput,
  type SourceProviderLimits,
  type SourceProviderResult
} from "./source-provider.js";

const ANALYSABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs"
]);

const GITIGNORE_FILE_NAME = ".gitignore";
const PNPM_WORKSPACE_FILE_NAME = "pnpm-workspace.yaml";

const GENERATED_FILE_PATTERNS = [
  "**/*.generated.*",
  "**/*.gen.*",
  "**/__generated__/**",
  "**/generated/**"
];

const ROLE_ORDER: FileRole[] = ["test", "story", "script", "config", "source"];

const DEFAULT_ROLE_PATTERNS: Readonly<Record<Exclude<FileRole, "source">, string[]>> =
  {
    test: [
      "*.test.*",
      "*.spec.*",
      "__tests__/**",
      "__mocks__/**",
      "**/test/**",
      "**/tests/**",
      "**/e2e/**"
    ],
    story: ["*.stories.*"],
    script: ["scripts/**", "**/scripts/**"],
    config: ["*.config.*", ".*rc.*"]
  };

const MINIMATCH_OPTIONS = {
  dot: true,
  matchBase: true
} as const;

interface SourceFileCandidate {
  path: string;
  absolutePath: string;
  sizeBytes: number;
}

interface IgnoreScope {
  /** Repo-relative POSIX directory containing the `.gitignore`, "" for the repository root. */
  baseDirectory: string;
  matcher: Ignore;
}

interface DiscoveryState {
  repositoryRoot: string;
  limits: SourceProviderLimits;
  diagnostics: SourceProviderDiagnostic[];
  candidates: SourceFileCandidate[];
  resolutionInputs: ResolutionInputFile[];
}

interface ResolutionInputFile {
  path: string;
  contentHash: string;
}

export class LocalFsSourceProvider implements SourceProvider {
  public async discover(input: SourceProviderInput): Promise<SourceProviderResult> {
    const repositoryRoot = path.resolve(input.repositoryRoot);
    const rolePatterns = resolveRolePatterns(input.analysisConfig);
    const state: DiscoveryState = {
      repositoryRoot,
      limits: this.resolveLimits(input.limits),
      diagnostics: [],
      candidates: [],
      resolutionInputs: []
    };

    await this.visitDirectory(repositoryRoot, [], state);

    state.candidates.sort((left, right) => compareStrings(left.path, right.path));
    state.resolutionInputs.sort((left, right) => compareStrings(left.path, right.path));

    // Each file is read once; hash, line count and parsing all use these bytes.
    const files: DiscoveredSourceFile[] = [];
    for (const candidate of state.candidates) {
      const bytes = await readFile(candidate.absolutePath);
      const content = bytes.toString("utf8");
      files.push({
        path: candidate.path,
        role: classifyFileRole(candidate.path, rolePatterns),
        sizeBytes: bytes.length,
        contentHash: sha256(bytes),
        loc: countLines(content),
        content
      });
    }

    return {
      files,
      diagnostics: state.diagnostics,
      sourceHash: createSourceHash(files, state.resolutionInputs, input.analysisConfig)
    };
  }

  private async visitDirectory(
    currentDirectory: string,
    inheritedScopes: IgnoreScope[],
    state: DiscoveryState
  ): Promise<void> {
    const { repositoryRoot, limits, diagnostics } = state;
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => compareStrings(left.name, right.name));

    const currentRelativeDirectory = toPosixPath(path.relative(repositoryRoot, currentDirectory));
    const scopes = await this.withDirectoryGitIgnore(
      currentDirectory,
      currentRelativeDirectory,
      entries,
      inheritedScopes
    );
    const isPackageOrRepositoryRoot = isRepositoryOrPackageRoot(
      currentDirectory === repositoryRoot,
      entries
    );

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = toPosixPath(path.relative(repositoryRoot, absolutePath));

      if (!relativePath) {
        continue;
      }

      const isDirectory = entry.isDirectory();
      if (isDirectory && isExcludedDirectory(entry.name, isPackageOrRepositoryRoot)) {
        continue;
      }

      if (isIgnored(relativePath, isDirectory, scopes)) {
        continue;
      }

      if (entry.isSymbolicLink()) {
        diagnostics.push({
          severity: "warning",
          code: "SOURCE_ENTRY_SYMLINK_SKIPPED",
          message: `Skipping symbolic link "${relativePath}".`,
          filePath: relativePath
        });
        continue;
      }

      if (isDirectory) {
        await this.visitDirectory(absolutePath, scopes, state);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (isResolutionInputFile(relativePath)) {
        state.resolutionInputs.push({
          path: relativePath,
          contentHash: sha256(await readFile(absolutePath))
        });
      }

      if (!isAnalysableSourceFile(relativePath) || isGeneratedFile(relativePath)) {
        continue;
      }

      const metadata = await stat(absolutePath);
      if (metadata.size > limits.maxFileBytes) {
        diagnostics.push({
          severity: "warning",
          code: "SOURCE_FILE_TOO_LARGE",
          message: `Skipping "${relativePath}" because it is ${metadata.size} bytes and exceeds the ${limits.maxFileBytes} byte file limit.`,
          filePath: relativePath
        });
        continue;
      }

      state.candidates.push({
        path: relativePath,
        absolutePath,
        sizeBytes: metadata.size
      });
    }
  }

  private async withDirectoryGitIgnore(
    directory: string,
    relativeDirectory: string,
    entries: ReadonlyArray<{ name: string; isFile(): boolean }>,
    inheritedScopes: IgnoreScope[]
  ): Promise<IgnoreScope[]> {
    const hasGitIgnore = entries.some(
      (entry) => entry.isFile() && entry.name === GITIGNORE_FILE_NAME
    );
    if (!hasGitIgnore) {
      return inheritedScopes;
    }

    const content = await readFile(path.join(directory, GITIGNORE_FILE_NAME), "utf8");
    return [...inheritedScopes, { baseDirectory: relativeDirectory, matcher: ignore().add(content) }];
  }

  private resolveLimits(
    inputLimits?: Partial<SourceProviderLimits>
  ): SourceProviderLimits {
    return {
      maxFileBytes: inputLimits?.maxFileBytes ?? DEFAULT_SOURCE_PROVIDER_LIMITS.maxFileBytes
    };
  }
}

/** Nested `.gitignore` files apply to their own subtree and take precedence over outer ones. */
function isIgnored(relativePath: string, isDirectory: boolean, scopes: IgnoreScope[]): boolean {
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    const scope = scopes[index];
    if (!scope) {
      continue;
    }

    const scopedPath = scope.baseDirectory
      ? relativePath.slice(scope.baseDirectory.length + 1)
      : relativePath;
    const result = scope.matcher.test(isDirectory ? `${scopedPath}/` : scopedPath);
    if (result.ignored) {
      return true;
    }

    if (result.unignored) {
      return false;
    }
  }

  return false;
}

/** Files whose content changes how imports resolve, so they feed the source hash. */
function isResolutionInputFile(relativePath: string): boolean {
  const fileName = path.posix.basename(relativePath);
  return (
    fileName === PACKAGE_MANIFEST_FILE_NAME ||
    (fileName.startsWith("tsconfig") && fileName.endsWith(".json")) ||
    relativePath === PNPM_WORKSPACE_FILE_NAME
  );
}

function countLines(content: string): number {
  return content.length === 0 ? 0 : content.split(/\r?\n/u).length;
}

function resolveRolePatterns(
  analysisConfig: AnalysisConfig
): Record<Exclude<FileRole, "source">, string[]> {
  return {
    test: analysisConfig.fileRoles.test ?? DEFAULT_ROLE_PATTERNS.test,
    story: analysisConfig.fileRoles.story ?? DEFAULT_ROLE_PATTERNS.story,
    script: analysisConfig.fileRoles.script ?? DEFAULT_ROLE_PATTERNS.script,
    config: analysisConfig.fileRoles.config ?? DEFAULT_ROLE_PATTERNS.config
  };
}

function classifyFileRole(
  filePath: string,
  rolePatterns: Record<Exclude<FileRole, "source">, string[]>
): FileRole {
  for (const role of ROLE_ORDER) {
    if (role === "source") {
      break;
    }

    const patterns = rolePatterns[role];
    if (
      patterns.some((pattern) => minimatch(filePath, pattern, MINIMATCH_OPTIONS))
    ) {
      return role;
    }
  }

  return "source";
}

function isAnalysableSourceFile(filePath: string): boolean {
  if (filePath.endsWith(".d.ts")) {
    return false;
  }

  const extension = path.posix.extname(filePath);
  return ANALYSABLE_EXTENSIONS.has(extension);
}

function isGeneratedFile(filePath: string): boolean {
  return GENERATED_FILE_PATTERNS.some((pattern) =>
    minimatch(filePath, pattern, MINIMATCH_OPTIONS)
  );
}

function createSourceHash(
  files: DiscoveredSourceFile[],
  resolutionInputs: ResolutionInputFile[],
  analysisConfig: AnalysisConfig
): string {
  const payload = {
    files: files.map((file) => ({
      path: file.path,
      contentHash: file.contentHash
    })),
    resolutionInputs,
    analysisConfig
  };

  return sha256(canonicalJson(payload));
}

function sha256(value: BinaryLike): string {
  return createHash("sha256").update(value).digest("hex");
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep);
}

