import { readdir } from "node:fs/promises";
import path from "node:path";

import { compareStrings } from "@archmind/domain";

export const EXCLUDED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next"
]);

/**
 * Lists repo-relative POSIX paths of every regular file under the repository
 * root, skipping symbolic links and vendored or build output directories.
 */
export async function discoverRepositoryFiles(repositoryRoot: string): Promise<Set<string>> {
  const discovered = new Set<string>();

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareStrings(left.name, right.name));

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(repositoryRoot, absolutePath).split(path.sep).join("/");
      if (!relativePath || entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          await visit(absolutePath);
        }
        continue;
      }

      if (entry.isFile()) {
        discovered.add(relativePath);
      }
    }
  };

  await visit(repositoryRoot);
  return discovered;
}
