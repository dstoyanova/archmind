import { readdir } from "node:fs/promises";
import path from "node:path";

import { compareStrings } from "@archmind/domain";

/** Never analysed, at any depth. */
const VENDORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "coverage",
  ".next"
]);

/** Build output, only where it is a package's own output directory. */
const BUILD_OUTPUT_DIRECTORY_NAMES: ReadonlySet<string> = new Set(["dist", "build", "out"]);

export const PACKAGE_MANIFEST_FILE_NAME = "package.json";

/**
 * Decides whether a directory is skipped by the file walks. `dist`, `build` and `out` are
 * build output only directly under the repository root or a package root; deeper they are
 * ordinary source folders (for example `src/build/`). Other build output is expected in `.gitignore`.
 */
export function isExcludedDirectory(
  directoryName: string,
  parentIsRepositoryOrPackageRoot: boolean
): boolean {
  return (
    VENDORED_DIRECTORY_NAMES.has(directoryName) ||
    (parentIsRepositoryOrPackageRoot && BUILD_OUTPUT_DIRECTORY_NAMES.has(directoryName))
  );
}

export function isRepositoryOrPackageRoot(
  isRepositoryRoot: boolean,
  entries: ReadonlyArray<{ name: string; isFile(): boolean }>
): boolean {
  return (
    isRepositoryRoot ||
    entries.some((entry) => entry.isFile() && entry.name === PACKAGE_MANIFEST_FILE_NAME)
  );
}

/**
 * Lists repo-relative POSIX paths of every regular file under the repository
 * root, skipping symbolic links and vendored or build output directories (see
 * {@link isExcludedDirectory}). `.gitignore` files are not applied here: the
 * resolver needs to know about ignored files to recognise imports into them.
 */
export async function discoverRepositoryFiles(repositoryRoot: string): Promise<Set<string>> {
  const discovered = new Set<string>();

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareStrings(left.name, right.name));
    const isPackageOrRepositoryRoot = isRepositoryOrPackageRoot(
      directory === repositoryRoot,
      entries
    );

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(repositoryRoot, absolutePath).split(path.sep).join("/");
      if (!relativePath || entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!isExcludedDirectory(entry.name, isPackageOrRepositoryRoot)) {
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
