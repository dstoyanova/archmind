import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { archmindConfigSchema } from "@archmind/contracts";
import { describe, expect, it } from "vitest";

import { LocalFsSourceProvider } from "./local-fs-source-provider.js";

function analysisConfig(overrides?: Record<string, unknown>) {
  return archmindConfigSchema.parse({
    analysis: {
      components: [],
      componentRoots: {},
      fileRoles: {},
      ...overrides
    }
  }).analysis;
}

describe("LocalFsSourceProvider", () => {
  it("discovers analysable files while respecting ignore rules and exclusions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archmind-source-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await mkdir(path.join(root, "node_modules/pkg"), { recursive: true });
      await mkdir(path.join(root, "dist"), { recursive: true });
      await mkdir(path.join(root, "src/generated"), { recursive: true });

      await writeFile(path.join(root, ".gitignore"), "src/ignored.ts\n");
      await writeFile(path.join(root, "src/keep.ts"), "export const keep = 1;\n");
      await writeFile(path.join(root, "src/ignored.ts"), "export const ignored = 1;\n");
      await writeFile(path.join(root, "src/types.d.ts"), "declare const x: number;\n");
      await writeFile(path.join(root, "src/generated/model.ts"), "export const generated = true;\n");
      await writeFile(path.join(root, "node_modules/pkg/index.ts"), "export const dep = 1;\n");
      await writeFile(path.join(root, "dist/output.ts"), "export const built = true;\n");

      const result = await new LocalFsSourceProvider().discover({
        repositoryRoot: root,
        analysisConfig: analysisConfig()
      });

      expect(result.files.map((file) => file.path)).toEqual(["src/keep.ts"]);
      expect(result.files[0]?.role).toBe("source");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies file roles using defaults and fileRoles overrides", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archmind-source-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await mkdir(path.join(root, "scripts"), { recursive: true });
      await mkdir(path.join(root, "tools"), { recursive: true });

      await writeFile(path.join(root, "src/main.ts"), "export const main = true;\n");
      await writeFile(path.join(root, "src/main.spec.ts"), "export const test = true;\n");
      await writeFile(path.join(root, "src/button.stories.tsx"), "export default {};\n");
      await writeFile(path.join(root, "scripts/release.ts"), "export const release = true;\n");
      await writeFile(path.join(root, "tools/build.ts"), "export const build = true;\n");
      await writeFile(path.join(root, "vite.config.ts"), "export default {};\n");

      const defaults = await new LocalFsSourceProvider().discover({
        repositoryRoot: root,
        analysisConfig: analysisConfig()
      });

      expect(
        Object.fromEntries(defaults.files.map((file) => [file.path, file.role]))
      ).toMatchObject({
        "src/main.ts": "source",
        "src/main.spec.ts": "test",
        "src/button.stories.tsx": "story",
        "scripts/release.ts": "script",
        "vite.config.ts": "config"
      });

      const withOverride = await new LocalFsSourceProvider().discover({
        repositoryRoot: root,
        analysisConfig: analysisConfig({
          fileRoles: {
            script: ["tools/**"]
          }
        })
      });

      expect(
        Object.fromEntries(withOverride.files.map((file) => [file.path, file.role]))
      ).toMatchObject({
        "scripts/release.ts": "source",
        "tools/build.ts": "script"
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("enforces file size limits and reports diagnostics for skipped files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archmind-source-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(path.join(root, "src/small.ts"), "ok\n");
      await writeFile(path.join(root, "src/large.ts"), "0123456789abcdef");

      const result = await new LocalFsSourceProvider().discover({
        repositoryRoot: root,
        analysisConfig: analysisConfig(),
        limits: {
          maxFileBytes: 5
        }
      });

      expect(result.files.map((file) => file.path)).toEqual(["src/small.ts"]);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          severity: "warning",
          code: "SOURCE_FILE_TOO_LARGE",
          filePath: "src/large.ts"
        })
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses deterministic path ordering and source hashing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archmind-source-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(path.join(root, "src/b.ts"), "export const b = 1;\n");
      await writeFile(path.join(root, "src/a.ts"), "export const a = 1;\n");
      await symlink(
        path.join(root, "src/a.ts"),
        path.join(root, "src/link.ts")
      );

      const provider = new LocalFsSourceProvider();
      const first = await provider.discover({
        repositoryRoot: root,
        analysisConfig: analysisConfig()
      });
      const second = await provider.discover({
        repositoryRoot: root,
        analysisConfig: analysisConfig({
          fileRoles: {
            test: ["**/*.spec.ts"]
          }
        })
      });

      expect(first.files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
      expect(first.sourceHash).not.toBe(second.sourceHash);
      expect(first.diagnostics).toEqual([
        expect.objectContaining({
          code: "SOURCE_ENTRY_SYMLINK_SKIPPED",
          filePath: "src/link.ts"
        })
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies nested .gitignore files only to their own subtree", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archmind-source-"));
    try {
      await mkdir(path.join(root, "pkg"), { recursive: true });
      await mkdir(path.join(root, "other"), { recursive: true });
      await writeFile(path.join(root, "pkg/.gitignore"), "secret.ts\n");
      await writeFile(path.join(root, "pkg/secret.ts"), "export const secret = 1;\n");
      await writeFile(path.join(root, "pkg/public.ts"), "export const open = 1;\n");
      await writeFile(path.join(root, "other/secret.ts"), "export const kept = 1;\n");

      const result = await new LocalFsSourceProvider().discover({
        repositoryRoot: root,
        analysisConfig: analysisConfig()
      });

      expect(result.files.map((file) => file.path)).toEqual(["other/secret.ts", "pkg/public.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("excludes build output at package roots but keeps nested source folders with the same names", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archmind-source-"));
    try {
      await mkdir(path.join(root, "dist"), { recursive: true });
      await mkdir(path.join(root, "packages/a/dist"), { recursive: true });
      await mkdir(path.join(root, "packages/a/src/build"), { recursive: true });
      await mkdir(path.join(root, "packages/a/src/out"), { recursive: true });
      await mkdir(path.join(root, ".git/hooks"), { recursive: true });
      await writeFile(path.join(root, "package.json"), "{}");
      await writeFile(path.join(root, "packages/a/package.json"), "{}");
      await writeFile(path.join(root, "dist/root.ts"), "export const r = 1;\n");
      await writeFile(path.join(root, "packages/a/dist/built.ts"), "export const b = 1;\n");
      await writeFile(path.join(root, "packages/a/src/build/real.ts"), "export const x = 1;\n");
      await writeFile(path.join(root, "packages/a/src/out/real2.ts"), "export const y = 1;\n");
      await writeFile(path.join(root, ".git/hooks/hook.js"), "module.exports = 1;\n");

      const result = await new LocalFsSourceProvider().discover({
        repositoryRoot: root,
        analysisConfig: analysisConfig()
      });

      expect(result.files.map((file) => file.path)).toEqual([
        "packages/a/src/build/real.ts",
        "packages/a/src/out/real2.ts"
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("changes the source hash when resolution-relevant config files change", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archmind-source-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(path.join(root, "src/a.ts"), "export const a = 1;\n");
      await writeFile(path.join(root, "tsconfig.json"), '{"compilerOptions":{"paths":{"@/*":["src/*"]}}}');
      const provider = new LocalFsSourceProvider();
      const discover = () => provider.discover({ repositoryRoot: root, analysisConfig: analysisConfig() });

      const before = await discover();
      expect((await discover()).sourceHash).toBe(before.sourceHash);

      await writeFile(path.join(root, "tsconfig.json"), '{"compilerOptions":{"paths":{"~/*":["src/*"]}}}');
      expect((await discover()).sourceHash).not.toBe(before.sourceHash);

      await writeFile(path.join(root, "package.json"), '{"name":"x"}');
      const withManifest = await discover();
      await writeFile(path.join(root, "package.json"), '{"name":"y"}');
      expect((await discover()).sourceHash).not.toBe(withManifest.sourceHash);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns the content and line count read during discovery", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archmind-source-"));
    try {
      await writeFile(path.join(root, "a.ts"), "export const a = 1;\nexport const b = 2;\n");

      const result = await new LocalFsSourceProvider().discover({
        repositoryRoot: root,
        analysisConfig: analysisConfig()
      });

      expect(result.files[0]).toMatchObject({
        content: "export const a = 1;\nexport const b = 2;\n",
        loc: 3
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
