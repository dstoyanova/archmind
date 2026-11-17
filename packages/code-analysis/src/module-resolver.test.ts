import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveFileImports } from "./module-resolver.js";

describe("resolveFileImports", () => {
  it("resolves relative imports, tsconfig paths, and workspace package exports", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archmind-resolve-"));
    try {
      await mkdir(path.join(root, "apps/web/src"), { recursive: true });
      await mkdir(path.join(root, "packages/lib/src/internal"), { recursive: true });
      await mkdir(path.join(root, "packages/config"), { recursive: true });

      await writeFile(
        path.join(root, "pnpm-workspace.yaml"),
        ["packages:", "  - apps/*", "  - packages/*"].join("\n")
      );
      await writeFile(
        path.join(root, "tsconfig.base.json"),
        JSON.stringify(
          {
            compilerOptions: {
              baseUrl: ".",
              paths: {
                "@lib/*": ["packages/lib/src/*"]
              }
            }
          },
          null,
          2
        )
      );
      await writeFile(
        path.join(root, "apps/web/tsconfig.json"),
        JSON.stringify(
          {
            extends: "../../tsconfig.base.json",
            compilerOptions: {
              module: "NodeNext",
              moduleResolution: "NodeNext"
            },
            include: ["src/**/*.ts"]
          },
          null,
          2
        )
      );
      await writeFile(
        path.join(root, "packages/lib/tsconfig.json"),
        JSON.stringify(
          {
            extends: "../config/tsconfig.base.json",
            compilerOptions: {
              rootDir: "src",
              outDir: "dist"
            },
            include: ["src/**/*.ts"]
          },
          null,
          2
        )
      );
      await writeFile(
        path.join(root, "packages/config/tsconfig.base.json"),
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022"
            }
          },
          null,
          2
        )
      );

      await writeFile(
        path.join(root, "apps/web/package.json"),
        JSON.stringify(
          {
            name: "@workspace/web"
          },
          null,
          2
        )
      );
      await writeFile(
        path.join(root, "packages/lib/package.json"),
        JSON.stringify(
          {
            name: "@workspace/lib",
            exports: {
              ".": "./dist/index.js",
              "./internal/*": "./dist/internal/*.js"
            },
            source: "./src/index.ts"
          },
          null,
          2
        )
      );
      await writeFile(path.join(root, "apps/web/src/main.ts"), "export {};\n");
      await writeFile(path.join(root, "apps/web/src/local.ts"), "export const local = 1;\n");
      await writeFile(path.join(root, "packages/lib/src/index.ts"), "export const lib = 1;\n");
      await writeFile(
        path.join(root, "packages/lib/src/internal/feature.ts"),
        "export const feature = true;\n"
      );
      await writeFile(path.join(root, "packages/lib/src/path-only.ts"), "export const p = true;\n");

      const result = await resolveFileImports({
        repositoryRoot: root,
        files: [{ filePath: "apps/web/src/main.ts" }],
        imports: [
          {
            filePath: "apps/web/src/main.ts",
            specifier: "./local.js",
            kind: "static",
            line: 1,
            column: 1
          },
          {
            filePath: "apps/web/src/main.ts",
            specifier: "@lib/path-only",
            kind: "static",
            line: 2,
            column: 1
          },
          {
            filePath: "apps/web/src/main.ts",
            specifier: "@workspace/lib",
            kind: "static",
            line: 3,
            column: 1
          },
          {
            filePath: "apps/web/src/main.ts",
            specifier: "@workspace/lib/internal/feature",
            kind: "static",
            line: 4,
            column: 1
          },
          {
            filePath: "apps/web/src/main.ts",
            specifier: "node:fs",
            kind: "static",
            line: 5,
            column: 1
          }
        ]
      });

      expect(result.diagnostics).toEqual([]);
      expect(result.imports).toEqual([
        expect.objectContaining({
          specifier: "./local.js",
          resolution: "internal-file",
          resolvedFilePath: "apps/web/src/local.ts"
        }),
        expect.objectContaining({
          specifier: "@lib/path-only",
          resolution: "internal-file",
          resolvedFilePath: "packages/lib/src/path-only.ts"
        }),
        expect.objectContaining({
          specifier: "@workspace/lib",
          resolution: "workspace-package",
          workspacePackage: "@workspace/lib",
          resolvedFilePath: "packages/lib/src/index.ts"
        }),
        expect.objectContaining({
          specifier: "@workspace/lib/internal/feature",
          resolution: "workspace-package",
          workspacePackage: "@workspace/lib",
          resolvedFilePath: "packages/lib/src/internal/feature.ts"
        }),
        expect.objectContaining({
          specifier: "node:fs",
          resolution: "node-built-in"
        })
      ]);

      expect(result.resolutionStats.countsByResolution).toMatchObject({
        "internal-file": 2,
        "workspace-package": 2,
        "node-built-in": 1
      });
      expect(result.resolutionStats.unresolvedRate).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports unresolved package extends and workspace entry fallback diagnostics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archmind-resolve-"));
    try {
      await mkdir(path.join(root, "apps/web/src"), { recursive: true });
      await mkdir(path.join(root, "packages/unmapped/src"), { recursive: true });

      await writeFile(
        path.join(root, "package.json"),
        JSON.stringify(
          {
            workspaces: ["apps/*", "packages/*"]
          },
          null,
          2
        )
      );
      await writeFile(
        path.join(root, "apps/web/package.json"),
        JSON.stringify(
          {
            name: "@workspace/web"
          },
          null,
          2
        )
      );
      await writeFile(
        path.join(root, "packages/unmapped/package.json"),
        JSON.stringify(
          {
            name: "@workspace/unmapped",
            exports: {
              ".": "./dist/missing.js"
            }
          },
          null,
          2
        )
      );
      await writeFile(
        path.join(root, "apps/web/tsconfig.json"),
        JSON.stringify(
          {
            extends: "@tsconfig/node20/tsconfig.json",
            compilerOptions: {
              module: "NodeNext",
              moduleResolution: "NodeNext"
            },
            include: ["src/**/*.ts"]
          },
          null,
          2
        )
      );
      await writeFile(path.join(root, "apps/web/src/main.ts"), "export {};\n");

      const result = await resolveFileImports({
        repositoryRoot: root,
        files: [{ filePath: "apps/web/src/main.ts" }],
        imports: [
          {
            filePath: "apps/web/src/main.ts",
            specifier: "@workspace/unmapped",
            kind: "static",
            line: 1,
            column: 1
          }
        ]
      });

      expect(result.imports).toEqual([
        expect.objectContaining({
          specifier: "@workspace/unmapped",
          resolution: "workspace-package",
          workspacePackage: "@workspace/unmapped"
        })
      ]);

      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "TSCONFIG_EXTENDS_UNRESOLVED_PACKAGE_SKIPPED",
            filePath: "apps/web/tsconfig.json"
          }),
          expect.objectContaining({
            code: "WORKSPACE_ENTRY_UNMAPPED",
            filePath: "apps/web/src/main.ts",
            line: 1
          })
        ])
      );
      expect(result.resolutionStats.unresolvedRate).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports missing relative extends with repo-relative text and keeps package extends separate", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "archmind-extends@-"));
    try {
      await mkdir(path.join(parent, "src"), { recursive: true });
      await writeFile(path.join(parent, "src/a.ts"), "export const a = 1;\n");
      await writeFile(
        path.join(parent, "tsconfig.json"),
        JSON.stringify({ extends: "./missing-base.json", include: ["src"] })
      );
      await writeFile(
        path.join(parent, "tsconfig.node.json"),
        JSON.stringify({ extends: "@tsconfig/node20/tsconfig.json", include: ["src"] })
      );

      const result = await resolveFileImports({
        repositoryRoot: parent,
        files: [{ filePath: "src/a.ts" }],
        imports: []
      });

      expect(result.diagnostics).toEqual([
        {
          severity: "error",
          code: "TSCONFIG_PARSE_ERROR",
          message: "Cannot read file 'missing-base.json'.",
          filePath: "tsconfig.json"
        },
        {
          severity: "warning",
          code: "TSCONFIG_EXTENDS_UNRESOLVED_PACKAGE_SKIPPED",
          message: "File '@tsconfig/node20/tsconfig.json' not found.",
          filePath: "tsconfig.node.json"
        }
      ]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("never resolves paths outside the repository root and tracks unresolved rate", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "archmind-resolve-parent-"));
    const root = path.join(parent, "repo");

    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(parent, "outside.ts"), "export const outside = true;\n");
    await writeFile(path.join(root, "src/main.ts"), "export {};\n");

    try {
      const result = await resolveFileImports({
        repositoryRoot: root,
        files: [{ filePath: "src/main.ts" }],
        imports: [
          {
            filePath: "src/main.ts",
            specifier: "../outside.ts",
            kind: "static",
            line: 1,
            column: 1
          },
          {
            filePath: "src/main.ts",
            specifier: "left-pad",
            kind: "static",
            line: 2,
            column: 1
          }
        ]
      });

      expect(result.imports).toEqual([
        expect.objectContaining({
          specifier: "../outside.ts",
          resolution: "unresolved"
        }),
        expect.objectContaining({
          specifier: "left-pad",
          resolution: "external-package",
          externalPackage: "left-pad"
        })
      ]);

      expect(result.resolutionStats.countsByResolution).toMatchObject({
        unresolved: 1,
        "external-package": 1
      });
      expect(result.resolutionStats.unresolvedRate).toBe(1);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
