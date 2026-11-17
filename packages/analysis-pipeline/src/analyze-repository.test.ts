import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { analyzeRepository } from "./analyze-repository.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "archmind-pipeline-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeRepoFile(relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
}

describe("analyzeRepository workspace handling", () => {
  it("builds package components only from the workspace packages list", async () => {
    await writeRepoFile("package.json", JSON.stringify({ name: "root", private: true }));
    await writeRepoFile(
      "pnpm-workspace.yaml",
      ["packages:", "  - packages/*", "onlyBuiltDependencies:", "  - tools/*"].join("\n")
    );
    await writeRepoFile("packages/a/package.json", JSON.stringify({ name: "@x/a" }));
    await writeRepoFile("packages/a/src/index.ts", "export const a = 1;\n");
    await writeRepoFile("tools/t/package.json", JSON.stringify({ name: "@x/t" }));
    await writeRepoFile("tools/t/src/index.ts", "export const t = 1;\n");

    const { snapshot } = await analyzeRepository({ repositoryRoot: root });

    const packageComponents = snapshot.components.filter((component) => component.kind === "package");
    expect(packageComponents.flatMap((component) => component.paths).sort()).toEqual([
      ".",
      "packages/a"
    ]);
  });

  it("reports a malformed manifest as a diagnostic instead of throwing", async () => {
    await writeRepoFile("package.json", JSON.stringify({ workspaces: ["packages/*"] }));
    await writeRepoFile("packages/a/package.json", "{ not json");
    await writeRepoFile("packages/a/src/index.ts", "export const a = 1;\n");

    const { snapshot } = await analyzeRepository({ repositoryRoot: root });

    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        code: "PACKAGE_MANIFEST_INVALID",
        filePath: "packages/a/package.json"
      })
    ]);
    expect(snapshot.files.map((file) => file.path)).toEqual(["packages/a/src/index.ts"]);
  });
});
