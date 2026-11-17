import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverWorkspace, parsePnpmWorkspacePackages } from "./workspace-discovery.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "archmind-workspace-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRepoFile(relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

describe("parsePnpmWorkspacePackages", () => {
  it("reads only the packages list and ignores other list sections", () => {
    const yaml = [
      "packages:",
      "  - apps/*",
      "  - 'packages/*' # trailing comment",
      '  - "!**/fixtures/**"',
      "onlyBuiltDependencies:",
      "  - tools/*",
      "catalog:",
      "  - nope"
    ].join("\n");

    expect(parsePnpmWorkspacePackages(yaml)).toEqual(["apps/*", "packages/*", "!**/fixtures/**"]);
  });
});

describe("discoverWorkspace", () => {
  it("does not treat other pnpm-workspace.yaml lists as workspace globs", async () => {
    await writeRepoFile("package.json", JSON.stringify({ name: "root" }));
    await writeRepoFile(
      "pnpm-workspace.yaml",
      ["packages:", "  - packages/*", "onlyBuiltDependencies:", "  - tools/*"].join("\n")
    );
    await writeRepoFile("packages/a/package.json", JSON.stringify({ name: "a" }));
    await writeRepoFile("tools/t/package.json", JSON.stringify({ name: "t" }));

    const { packages } = await discoverWorkspace(root);

    expect(packages.map((workspacePackage) => workspacePackage.directory)).toEqual([
      ".",
      "packages/a"
    ]);
  });

  it("supports negation globs from package.json and pnpm-workspace.yaml", async () => {
    await writeRepoFile(
      "package.json",
      JSON.stringify({ workspaces: ["packages/*", "!packages/legacy"] })
    );
    await writeRepoFile(
      "pnpm-workspace.yaml",
      ["packages:", "  - tools/*", "  - '!tools/internal'"].join("\n")
    );
    for (const directory of ["packages/a", "packages/legacy", "tools/cli", "tools/internal"]) {
      await writeRepoFile(`${directory}/package.json`, JSON.stringify({ name: directory }));
    }

    const { packages } = await discoverWorkspace(root);

    expect(packages.map((workspacePackage) => workspacePackage.directory)).toEqual([
      ".",
      "packages/a",
      "tools/cli"
    ]);
  });

  it("keeps a package with a malformed manifest and reports a diagnostic instead of throwing", async () => {
    await writeRepoFile("package.json", JSON.stringify({ workspaces: ["packages/*"] }));
    await writeRepoFile("packages/a/package.json", "{ not json");
    await writeRepoFile("packages/b/package.json", JSON.stringify({ name: "b" }));

    const { packages, diagnostics } = await discoverWorkspace(root);

    expect(packages.map((workspacePackage) => workspacePackage.directory)).toEqual([
      ".",
      "packages/a",
      "packages/b"
    ]);
    expect(
      packages.find((workspacePackage) => workspacePackage.directory === "packages/a")?.manifest
    ).toEqual({});
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "PACKAGE_MANIFEST_INVALID",
        filePath: "packages/a/package.json"
      })
    ]);
    expect(diagnostics[0]?.message).not.toContain(root);
  });
});
