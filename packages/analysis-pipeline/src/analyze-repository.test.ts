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

    const packageComponents = snapshot.components.filter(
      (component) => component.kind === "package"
    );
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

  it("reports a duplicate workspace package name and resolves it to the first directory", async () => {
    await writeRepoFile("package.json", JSON.stringify({ workspaces: ["packages/*"] }));
    await writeRepoFile("packages/a/package.json", JSON.stringify({ name: "@x/dup" }));
    await writeRepoFile("packages/a/src/index.ts", "export const a = 1;\n");
    await writeRepoFile("packages/b/package.json", JSON.stringify({ name: "@x/dup" }));
    await writeRepoFile("packages/b/src/index.ts", "export const b = 1;\n");
    await writeRepoFile("packages/c/package.json", JSON.stringify({ name: "@x/c" }));
    await writeRepoFile(
      "packages/c/src/index.ts",
      "import { a } from '@x/dup';\nexport const c = a;\n"
    );

    const { snapshot } = await analyzeRepository({ repositoryRoot: root });

    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({
        code: "WORKSPACE_PACKAGE_NAME_DUPLICATE",
        filePath: "packages/a/package.json",
        message: expect.stringContaining('imports of it resolve to "packages/a"')
      })
    ]);
    const componentById = new Map(
      snapshot.components.map((component) => [component.id, component])
    );
    const importTargets = snapshot.dependencies
      .filter((dependency) =>
        componentById.get(dependency.fromComponentId)?.paths.includes("packages/c")
      )
      .map((dependency) => componentById.get(dependency.toComponentId)?.paths);
    expect(importTargets).toEqual([["packages/a"]]);
  });
});

describe("analyzeRepository configuration", () => {
  it("reports invalid configuration readably instead of throwing a raw ZodError", async () => {
    await writeRepoFile(
      "archmind.config.json",
      JSON.stringify({ analysis: { components: "nope" } })
    );

    await expect(analyzeRepository({ repositoryRoot: root })).rejects.toThrow(
      /Invalid "archmind\.config\.json":\n- analysis\.components: /u
    );
  });

  it("rejects misspelled analysis keys", async () => {
    await writeRepoFile(
      "archmind.config.json",
      JSON.stringify({ analysis: { componentRoot: {} } })
    );

    await expect(analyzeRepository({ repositoryRoot: root })).rejects.toThrow(/componentRoot/u);
  });

  it("reports an unknown configured parent as a diagnostic", async () => {
    await writeRepoFile(
      "archmind.config.json",
      JSON.stringify({
        analysis: { components: [{ name: "x", paths: ["src/**"], parent: "nope" }] }
      })
    );
    await writeRepoFile("src/index.ts", "export const a = 1;\n");

    const { snapshot } = await analyzeRepository({ repositoryRoot: root });

    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({ code: "CONFIG_COMPONENT_PARENT_UNKNOWN" })
    ]);
  });
});

describe("analyzeRepository output guard", () => {
  // When this fails, analysis output changed. Bump ENGINE_VERSION in
  // @archmind/architecture-engine, then update the golden values.
  it("changes contentHash only together with the engine or parser version", async () => {
    await writeRepoFile(
      "package.json",
      JSON.stringify({ name: "guard-root", workspaces: ["packages/*"] })
    );
    await writeRepoFile("packages/a/package.json", JSON.stringify({ name: "@guard/a" }));
    await writeRepoFile(
      "packages/a/src/index.ts",
      "import { b } from '@guard/b';\nimport fs from 'node:fs';\nimport './styles.css';\nexport { b };\nexport const a = 1;\n"
    );
    await writeRepoFile("packages/b/package.json", JSON.stringify({ name: "@guard/b" }));
    await writeRepoFile(
      "packages/b/src/index.ts",
      "import type { a } from '@guard/a';\nexport const b: typeof a = 2;\n"
    );

    const { snapshot } = await analyzeRepository({ repositoryRoot: root });

    expect(snapshot.diagnostics).toEqual([]);
    expect({
      engineVersion: snapshot.engineVersion,
      parserVersion: snapshot.parserVersion,
      contentHash: snapshot.contentHash
    }).toEqual({
      engineVersion: "0.3.0",
      parserVersion: "5.9.3",
      contentHash: "d30bf4d740db42ee32024870b1c4db0c9808f08da8cc71372d97789fdc4c28e9"
    });
  });
});
