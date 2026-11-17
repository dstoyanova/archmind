import { createHash, type BinaryLike } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { AnalysisConfig } from "@archmind/contracts";
import { canonicalJson, compareStrings } from "@archmind/domain";
import ignore from "ignore";
import { minimatch } from "minimatch";

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

const EXCLUDED_DIRECTORY_NAMES = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next"
]);

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

export class LocalFsSourceProvider implements SourceProvider {
  public async discover(input: SourceProviderInput): Promise<SourceProviderResult> {
    const repositoryRoot = path.resolve(input.repositoryRoot);
    const diagnostics: SourceProviderDiagnostic[] = [];
    const limits = this.resolveLimits(input.limits);
    const rolePatterns = resolveRolePatterns(input.analysisConfig);

    const rootIgnore = await this.loadRootGitIgnore(repositoryRoot);
    const sourceFiles = await this.discoverCandidates(
      repositoryRoot,
      repositoryRoot,
      rootIgnore,
      limits,
      diagnostics
    );

    sourceFiles.sort((left, right) => compareStrings(left.path, right.path));

    const files: DiscoveredSourceFile[] = [];
    for (const file of sourceFiles) {
      const content = await readFile(file.absolutePath);
      files.push({
        path: file.path,
        role: classifyFileRole(file.path, rolePatterns),
        sizeBytes: file.sizeBytes,
        contentHash: sha256(content)
      });
    }

    return {
      files,
      diagnostics,
      sourceHash: createSourceHash(files, input.analysisConfig)
    };
  }

  private async loadRootGitIgnore(repositoryRoot: string) {
    const ignoreFilePath = path.join(repositoryRoot, ".gitignore");

    try {
      const content = await readFile(ignoreFilePath, "utf8");
      return ignore().add(content);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return ignore();
      }

      throw error;
    }
  }

  private async discoverCandidates(
    repositoryRoot: string,
    currentDirectory: string,
    rootIgnore: ReturnType<typeof ignore>,
    limits: SourceProviderLimits,
    diagnostics: SourceProviderDiagnostic[]
  ): Promise<SourceFileCandidate[]> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => compareStrings(left.name, right.name));

    const sourceFiles: SourceFileCandidate[] = [];

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = toPosixPath(path.relative(repositoryRoot, absolutePath));

      if (!relativePath) {
        continue;
      }

      const isDirectory = entry.isDirectory();
      if (isDirectory && EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }

      if (rootIgnore.ignores(isDirectory ? `${relativePath}/` : relativePath)) {
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
        const nestedFiles = await this.discoverCandidates(
          repositoryRoot,
          absolutePath,
          rootIgnore,
          limits,
          diagnostics
        );
        sourceFiles.push(...nestedFiles);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!isAnalysableSourceFile(relativePath)) {
        continue;
      }

      if (isGeneratedFile(relativePath)) {
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

      sourceFiles.push({
        path: relativePath,
        absolutePath,
        sizeBytes: metadata.size
      });
    }

    return sourceFiles;
  }

  private resolveLimits(
    inputLimits?: Partial<SourceProviderLimits>
  ): SourceProviderLimits {
    return {
      maxFileBytes: inputLimits?.maxFileBytes ?? DEFAULT_SOURCE_PROVIDER_LIMITS.maxFileBytes
    };
  }
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
  analysisConfig: AnalysisConfig
): string {
  const payload = {
    files: files.map((file) => ({
      path: file.path,
      contentHash: file.contentHash
    })),
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

function isNodeError(error: unknown): error is { code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  );
}
