import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { extractImportsAndSymbols } from "./import-symbol-extractor.js";

describe("extractImportsAndSymbols", () => {
  it("extracts import kinds and exported symbols with line/column positions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archmind-extract-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(
        path.join(root, "src/main.ts"),
        [
          "import foo from './foo.js';",
          "import { type A, type B } from './types.js';",
          "import { type C, D } from './mixed.js';",
          "import type { E } from './type-only.js';",
          "export { x } from './re-export.js';",
          "export type { Y } from './types-export.js';",
          "const lazy = import('./dynamic.js');",
          "const dep = require('./required.js');",
          "",
          "export function run() {}",
          "export default class {}",
          "export interface Contract {}",
          "export type Alias = string;",
          "export enum Mode { On = 'on' }",
          "export const value = 1, second = 2;",
          "export const { nested } = { nested: 1 };"
        ].join("\n")
      );

      const result = await extractImportsAndSymbols({
        repositoryRoot: root,
        files: [{ path: "src/main.ts" }]
      });

      expect(result.diagnostics).toEqual([]);

      expect(result.imports).toEqual([
        {
          filePath: "src/main.ts",
          specifier: "./foo.js",
          kind: "static",
          line: 1,
          column: 1
        },
        {
          filePath: "src/main.ts",
          specifier: "./types.js",
          kind: "type-only",
          line: 2,
          column: 1
        },
        {
          filePath: "src/main.ts",
          specifier: "./mixed.js",
          kind: "static",
          line: 3,
          column: 1
        },
        {
          filePath: "src/main.ts",
          specifier: "./type-only.js",
          kind: "type-only",
          line: 4,
          column: 1
        },
        {
          filePath: "src/main.ts",
          specifier: "./re-export.js",
          kind: "re-export",
          line: 5,
          column: 1
        },
        {
          filePath: "src/main.ts",
          specifier: "./types-export.js",
          kind: "type-only",
          line: 6,
          column: 1
        },
        {
          filePath: "src/main.ts",
          specifier: "./dynamic.js",
          kind: "dynamic",
          line: 7,
          column: 14
        },
        {
          filePath: "src/main.ts",
          specifier: "./required.js",
          kind: "require",
          line: 8,
          column: 13
        }
      ]);

      expect(result.symbols).toEqual([
        {
          filePath: "src/main.ts",
          name: "run",
          kind: "function",
          line: 10,
          column: 1
        },
        {
          filePath: "src/main.ts",
          name: "default",
          kind: "class",
          line: 11,
          column: 1
        },
        {
          filePath: "src/main.ts",
          name: "Contract",
          kind: "interface",
          line: 12,
          column: 1
        },
        {
          filePath: "src/main.ts",
          name: "Alias",
          kind: "type",
          line: 13,
          column: 1
        },
        {
          filePath: "src/main.ts",
          name: "Mode",
          kind: "enum",
          line: 14,
          column: 1
        },
        {
          filePath: "src/main.ts",
          name: "second",
          kind: "variable",
          line: 15,
          column: 1
        },
        {
          filePath: "src/main.ts",
          name: "value",
          kind: "variable",
          line: 15,
          column: 1
        },
        {
          filePath: "src/main.ts",
          name: "nested",
          kind: "variable",
          line: 16,
          column: 1
        }
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reports diagnostics for malformed files and continues analysis", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "archmind-extract-"));
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(path.join(root, "src/broken.ts"), "import { from './broken';\n");
      await writeFile(path.join(root, "src/valid.ts"), "export const ok = true;\n");

      const result = await extractImportsAndSymbols({
        repositoryRoot: root,
        files: [{ path: "src/broken.ts" }, { path: "src/valid.ts" }]
      });

      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          severity: "error",
          code: "SOURCE_FILE_PARSE_ERROR",
          filePath: "src/broken.ts",
          line: 1
        })
      ]);

      expect(result.symbols).toEqual([
        {
          filePath: "src/valid.ts",
          name: "ok",
          kind: "variable",
          line: 1,
          column: 1
        }
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
