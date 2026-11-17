import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 2000;
// Exit code git uses for "fatal" errors such as running outside a work tree.
const GIT_FATAL_EXIT_CODE = 128;
// Prevents a hostile `.git/config` from running commands (for example `core.fsmonitor`) in the analysed repository.
const GIT_SAFETY_OPTIONS = ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];

export interface GitSourceMetadata {
  commitSha?: string | undefined;
  branch?: string | undefined;
  commitTimestamp?: string | undefined;
  workingTreeDirty?: boolean | undefined;
}

export interface GitSourceMetadataResult {
  metadata: GitSourceMetadata;
  /**
   * Unexpected git failures (timeouts, crashes). They are not part of the snapshot, so its
   * `contentHash` does not depend on git behaviour; the caller decides how to surface them.
   */
  warnings: string[];
}

type GitCommandResult =
  | { status: "ok"; stdout: string }
  /** Expected: git is not installed, or the path is not a repository. */
  | { status: "unavailable" }
  | { status: "failed"; warning: string };

/**
 * Reads commit metadata only when `repositoryRoot` is the top level of a git
 * work tree. For a subdirectory of a larger repository the commit describes a
 * different scope than the analysed files, so no metadata is recorded.
 * `workingTreeDirty` stays undefined when the status cannot be determined.
 */
export async function readGitSourceMetadata(
  repositoryRoot: string
): Promise<GitSourceMetadataResult> {
  const warnings: string[] = [];
  const run = async (args: string[]): Promise<string | undefined> => {
    const result = await runGitCommand(repositoryRoot, args);
    if (result.status === "failed") {
      warnings.push(result.warning);
    }

    return result.status === "ok" ? result.stdout : undefined;
  };

  const topLevel = await run(["rev-parse", "--show-toplevel"]);
  if (!topLevel || !(await isSameDirectory(topLevel, repositoryRoot))) {
    return { metadata: {}, warnings };
  }

  const [commitSha, branch, commitTimestamp, status] = await Promise.all([
    run(["rev-parse", "HEAD"]),
    run(["rev-parse", "--abbrev-ref", "HEAD"]),
    run(["show", "-s", "--format=%cI", "HEAD"]),
    run(["status", "--porcelain"])
  ]);

  if (!commitSha || !branch || !commitTimestamp) {
    return { metadata: {}, warnings };
  }

  return {
    metadata: {
      commitSha,
      branch,
      commitTimestamp,
      workingTreeDirty: status === undefined ? undefined : status !== ""
    },
    warnings
  };
}

async function isSameDirectory(left: string, right: string): Promise<boolean> {
  try {
    return (await realpath(left)) === (await realpath(right));
  } catch (error) {
    if (isExecError(error) && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return false;
    }

    throw error;
  }
}

async function runGitCommand(repositoryRoot: string, args: string[]): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", [...GIT_SAFETY_OPTIONS, ...args], {
      cwd: repositoryRoot,
      timeout: GIT_TIMEOUT_MS
    });
    return { status: "ok", stdout: result.stdout.trim() };
  } catch (error) {
    // Git is optional: a missing binary or a non-repository simply means "no metadata".
    if (isExecError(error) && (error.code === "ENOENT" || error.code === GIT_FATAL_EXIT_CODE)) {
      return { status: "unavailable" };
    }

    return {
      status: "failed",
      warning: `Git metadata is incomplete: "git ${args[0] ?? ""}" ${describeGitFailure(error)}.`
    };
  }
}

function describeGitFailure(error: unknown): string {
  if (isExecError(error)) {
    if (error.killed) {
      return `timed out after ${GIT_TIMEOUT_MS} ms`;
    }

    if (error.code !== undefined) {
      return `failed (${String(error.code)})`;
    }
  }

  return "failed";
}

function isExecError(
  error: unknown
): error is { code?: string | number; killed?: boolean } {
  return typeof error === "object" && error !== null;
}
