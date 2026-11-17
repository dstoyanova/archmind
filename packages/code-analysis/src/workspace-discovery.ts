import { readFile } from "node:fs/promises";
import path from "node:path";

import { compareStrings } from "@archmind/domain";
import { minimatch } from "minimatch";

import { discoverRepositoryFiles } from "./repository-files.js";

export interface PackageManifest {
  name?: string | undefined;
  exports?: unknown;
  imports?: unknown;
  main?: string | undefined;
  module?: string | undefined;
  types?: string | undefined;
  source?: string | undefined;
  workspaces?: string[] | { packages?: string[] | undefined } | undefined;
}

export interface WorkspaceDiagnostic {
  severity: "warning" | "error";
  code: string;
  message: string;
  filePath?: string | undefined;
  line?: number | undefined;
}

export interface WorkspacePackageInfo {
  /** Repo-relative POSIX directory, "." for the repository root. */
  directory: string;
  /** Parsed manifest, or an empty object when it is missing or malformed. */
  manifest: PackageManifest;
}

export interface WorkspaceDiscoveryResult {
  packages: WorkspacePackageInfo[];
  diagnostics: WorkspaceDiagnostic[];
}

/**
 * Single source of truth for which directories are workspace packages. Used by
 * module resolution and by component mapping so they cannot disagree.
 *
 * Patterns come from the root `package.json` `workspaces` field and the
 * `packages:` list of `pnpm-workspace.yaml`. Patterns starting with `!` exclude
 * directories. Without any patterns every `package.json` directory is a package.
 */
export async function discoverWorkspace(
  repositoryRoot: string,
  repositoryFiles?: ReadonlySet<string>
): Promise<WorkspaceDiscoveryResult> {
  const root = path.resolve(repositoryRoot);
  const files = repositoryFiles ?? (await discoverRepositoryFiles(root));
  const diagnostics: WorkspaceDiagnostic[] = [];
  const manifestsByDirectory = new Map<string, PackageManifest>();

  const manifestPaths = [...files]
    .filter((filePath) => path.posix.basename(filePath) === "package.json")
    .sort(compareStrings);
  for (const manifestPath of manifestPaths) {
    const manifest = await readManifest(root, manifestPath, diagnostics);
    manifestsByDirectory.set(path.posix.dirname(manifestPath), manifest);
  }

  const patterns = collectWorkspacePatterns(
    manifestsByDirectory.get(".") ?? {},
    files.has("pnpm-workspace.yaml") ? await readTextFileIfPresent(root, "pnpm-workspace.yaml") : null
  );
  const includePatterns = patterns.filter((pattern) => !pattern.startsWith("!"));
  const excludePatterns = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1));

  const packages = [...manifestsByDirectory.entries()]
    .filter(([directory]) => {
      if (directory === ".") {
        return true;
      }

      const included =
        includePatterns.length === 0 ||
        includePatterns.some((pattern) => matchesDirectory(directory, pattern));
      return included && !excludePatterns.some((pattern) => matchesDirectory(directory, pattern));
    })
    .map(([directory, manifest]) => ({ directory, manifest }))
    .sort((left, right) => compareStrings(left.directory, right.directory));

  return { packages, diagnostics };
}

function collectWorkspacePatterns(
  rootManifest: PackageManifest,
  pnpmWorkspaceYaml: string | null
): string[] {
  const patterns = new Set<string>();
  const workspaces = rootManifest.workspaces;
  const manifestPatterns = Array.isArray(workspaces) ? workspaces : workspaces?.packages;
  for (const pattern of manifestPatterns ?? []) {
    addPattern(patterns, pattern);
  }

  for (const pattern of pnpmWorkspaceYaml ? parsePnpmWorkspacePackages(pnpmWorkspaceYaml) : []) {
    addPattern(patterns, pattern);
  }

  return [...patterns].sort(compareStrings);
}

function addPattern(patterns: Set<string>, pattern: unknown): void {
  if (typeof pattern !== "string") {
    return;
  }

  const isNegated = pattern.startsWith("!");
  const normalized = (isNegated ? pattern.slice(1) : pattern).replace(/^\.\//u, "").replace(/\/+$/u, "");
  if (normalized) {
    patterns.add(isNegated ? `!${normalized}` : normalized);
  }
}

/** Reads only the `packages:` list, so other list sections are not mistaken for globs. */
export function parsePnpmWorkspacePackages(content: string): string[] {
  const patterns: string[] = [];
  let insidePackages = false;

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    if (/^packages:\s*(#.*)?$/u.test(line)) {
      insidePackages = true;
      continue;
    }

    if (!insidePackages) {
      continue;
    }

    if (!line.startsWith("-")) {
      break;
    }

    const pattern = line
      .replace(/^-+\s*/u, "")
      .replace(/\s+#.*$/u, "")
      .trim()
      .replace(/^['"]|['"]$/gu, "");
    if (pattern) {
      patterns.push(pattern);
    }
  }

  return patterns;
}

function matchesDirectory(directory: string, pattern: string): boolean {
  return minimatch(directory, pattern, { dot: true });
}

async function readManifest(
  repositoryRoot: string,
  manifestPath: string,
  diagnostics: WorkspaceDiagnostic[]
): Promise<PackageManifest> {
  try {
    const content = await readTextFileIfPresent(repositoryRoot, manifestPath);
    if (content === null) {
      return {};
    }

    const parsed: unknown = JSON.parse(content);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("Manifest is not a JSON object.");
    }

    return parsed as PackageManifest;
  } catch {
    // The message deliberately omits parser and OS error text, which vary by host and Node version.
    diagnostics.push({
      severity: "warning",
      code: "PACKAGE_MANIFEST_INVALID",
      message: `Could not read "${manifestPath}" as a JSON object; treating it as an empty manifest.`,
      filePath: manifestPath
    });
    return {};
  }
}

async function readTextFileIfPresent(
  repositoryRoot: string,
  relativePath: string
): Promise<string | null> {
  try {
    return await readFile(path.join(repositoryRoot, relativePath), "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "EISDIR")
    ) {
      return null;
    }

    throw error;
  }
}
