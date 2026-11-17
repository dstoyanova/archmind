import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 2000;
// Prevents a hostile `.git/config` from running commands (for example `core.fsmonitor`) in the analysed repository.
const GIT_SAFETY_OPTIONS = ["--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];

export interface GitSourceMetadata {
  commitSha?: string | undefined;
  branch?: string | undefined;
  commitTimestamp?: string | undefined;
  workingTreeDirty?: boolean | undefined;
}

/**
 * Reads commit metadata only when `repositoryRoot` is the top level of a git
 * work tree. For a subdirectory of a larger repository the commit describes a
 * different scope than the analysed files, so no metadata is recorded.
 * `workingTreeDirty` stays undefined when the status cannot be determined.
 */
export async function readGitSourceMetadata(repositoryRoot: string): Promise<GitSourceMetadata> {
  const topLevel = await runGitCommand(repositoryRoot, ["rev-parse", "--show-toplevel"]);
  if (!topLevel || !(await isSameDirectory(topLevel, repositoryRoot))) {
    return {};
  }

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
    workingTreeDirty: status === undefined ? undefined : status !== ""
  };
}

async function isSameDirectory(left: string, right: string): Promise<boolean> {
  try {
    return (await realpath(left)) === (await realpath(right));
  } catch {
    return false;
  }
}

async function runGitCommand(
  repositoryRoot: string,
  args: string[]
): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", [...GIT_SAFETY_OPTIONS, ...args], {
      cwd: repositoryRoot,
      timeout: GIT_TIMEOUT_MS
    });
    return result.stdout.trim();
  } catch {
    // Git is optional: a missing binary, a non-repository or a timeout all mean "no metadata".
    return undefined;
  }
}
