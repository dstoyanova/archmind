import { execFileSync } from "node:child_process";
import { access, chmod, mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readGitSourceMetadata } from "./git-source-metadata.js";

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "archmind-git-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { cwd: root, encoding: "utf8" }
  );
}

async function createCommittedRepository(): Promise<void> {
  git("init", "--quiet");
  await writeFile(path.join(root, "a.ts"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "--quiet", "-m", "initial");
}

describe("readGitSourceMetadata", () => {
  it("records commit metadata and a clean tree for a repository top level", async () => {
    await createCommittedRepository();

    const { metadata } = await readGitSourceMetadata(root);

    expect(metadata.commitSha).toBe(git("rev-parse", "HEAD").trim());
    expect(metadata.workingTreeDirty).toBe(false);
  });

  it("reports a dirty working tree", async () => {
    await createCommittedRepository();
    await writeFile(path.join(root, "b.ts"), "export const b = 1;\n");

    expect((await readGitSourceMetadata(root)).metadata.workingTreeDirty).toBe(true);
  });

  it("records nothing when the analysed path is a subdirectory of the repository", async () => {
    await createCommittedRepository();
    await mkdir(path.join(root, "packages/a"), { recursive: true });

    expect(await readGitSourceMetadata(path.join(root, "packages/a"))).toEqual({
      metadata: {},
      warnings: []
    });
  });

  it("records nothing and does not warn outside a git repository", async () => {
    expect(await readGitSourceMetadata(root)).toEqual({ metadata: {}, warnings: [] });
  });

  it("warns, instead of staying silent, when git fails unexpectedly", async () => {
    const binDirectory = path.join(root, "bin");
    await mkdir(binDirectory);
    const fakeGit = path.join(binDirectory, "git");
    await writeFile(fakeGit, "#!/bin/sh\nexit 1\n");
    await chmod(fakeGit, 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${binDirectory}${path.delimiter}${originalPath ?? ""}`;

    try {
      const result = await readGitSourceMetadata(root);

      expect(result.metadata).toEqual({});
      expect(result.warnings).toEqual(['Git metadata is incomplete: "git rev-parse" failed (1).']);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("does not run commands configured in the analysed repository's git config", async () => {
    await createCommittedRepository();
    const marker = path.join(root, "fsmonitor-ran");
    const hook = path.join(root, "hook.sh");
    await writeFile(hook, `#!/bin/sh\ntouch "${marker}"\n`);
    await chmod(hook, 0o755);
    git("config", "core.fsmonitor", hook);

    await readGitSourceMetadata(root);

    await expect(access(marker)).rejects.toThrow();
  });
});
