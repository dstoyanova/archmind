import { describe, expect, it } from "vitest";

import { architectureSnapshotSchema } from "@archmind/contracts";

import { buildArchitectureSnapshot } from "./snapshot-builder.js";

describe("buildArchitectureSnapshot", () => {
  it("builds schema-valid snapshots and keeps contentHash stable across metadata changes", () => {
    const first = buildArchitectureSnapshot({
      schemaVersion: "1",
      engineVersion: "0.1.0",
      parserVersion: "5.9.3",
      analysisConfigHash: "cfg-1",
      source: {
        kind: "local",
        sourceHash: "source-a",
        commitSha: "abc123",
        branch: "main",
        commitTimestamp: "2026-11-16T10:00:00.000Z",
        workingTreeDirty: false
      },
      createdAt: "2026-11-16T10:10:00.000Z",
      components: [
        {
          id: "root",
          name: "<root>",
          depth: 0,
          kind: "root",
          paths: ["."]
        },
        {
          id: "package:packages/lib",
          name: "lib",
          parentId: "root",
          depth: 1,
          kind: "package",
          paths: ["packages/lib"]
        },
        {
          id: "folder:packages/lib/src",
          name: "src",
          parentId: "package:packages/lib",
          depth: 2,
          kind: "folder",
          paths: ["packages/lib/src"]
        }
      ],
      ownership: [
        {
          filePath: "packages/lib/src/b.ts",
          componentId: "folder:packages/lib/src"
        },
        {
          filePath: "packages/lib/src/a.ts",
          componentId: "folder:packages/lib/src"
        }
      ],
      files: [
        { path: "packages/lib/src/b.ts", role: "source" },
        { path: "packages/lib/src/a.ts", role: "source" }
      ],
      fileImports: [
        {
          filePath: "packages/lib/src/b.ts",
          specifier: "./a.js",
          kind: "type-only",
          line: 1,
          column: 1,
          resolution: "internal-file",
          resolvedFilePath: "packages/lib/src/a.ts"
        }
      ],
      symbols: [
        {
          filePath: "packages/lib/src/a.ts",
          name: "A",
          kind: "type",
          line: 1,
          column: 1
        }
      ],
      resolutionStats: {
        countsByResolution: {
          "internal-file": 1
        },
        unresolvedRate: 0
      },
      diagnostics: [
        {
          severity: "warning",
          code: "SOURCE_FILE_PARSE_ERROR",
          message: "broken syntax",
          filePath: "packages/lib/src/a.ts",
          line: 1
        }
      ]
    });

    const second = buildArchitectureSnapshot({
      schemaVersion: "1",
      engineVersion: "0.1.0",
      parserVersion: "5.9.3",
      analysisConfigHash: "cfg-1",
      source: {
        kind: "local",
        sourceHash: "source-a",
        commitSha: "def456",
        branch: "feature/reproducible",
        commitTimestamp: "2026-11-17T10:00:00.000Z",
        workingTreeDirty: true
      },
      createdAt: "2026-11-18T10:10:00.000Z",
      components: [
        {
          id: "folder:packages/lib/src",
          name: "src",
          parentId: "package:packages/lib",
          depth: 2,
          kind: "folder",
          paths: ["packages/lib/src"]
        },
        {
          id: "root",
          name: "<root>",
          depth: 0,
          kind: "root",
          paths: ["."]
        },
        {
          id: "package:packages/lib",
          name: "lib",
          parentId: "root",
          depth: 1,
          kind: "package",
          paths: ["packages/lib"]
        }
      ],
      ownership: [
        {
          filePath: "packages/lib/src/a.ts",
          componentId: "folder:packages/lib/src"
        },
        {
          filePath: "packages/lib/src/b.ts",
          componentId: "folder:packages/lib/src"
        }
      ],
      files: [
        { path: "packages/lib/src/a.ts", role: "source" },
        { path: "packages/lib/src/b.ts", role: "source" }
      ],
      fileImports: [
        {
          filePath: "packages/lib/src/b.ts",
          specifier: "./a.js",
          kind: "type-only",
          line: 1,
          column: 1,
          resolution: "internal-file",
          resolvedFilePath: "packages/lib/src/a.ts"
        }
      ],
      symbols: [
        {
          filePath: "packages/lib/src/a.ts",
          name: "A",
          kind: "type",
          line: 1,
          column: 1
        }
      ],
      resolutionStats: {
        countsByResolution: {
          "internal-file": 1
        },
        unresolvedRate: 0
      },
      diagnostics: [
        {
          severity: "warning",
          code: "SOURCE_FILE_PARSE_ERROR",
          message: "broken syntax",
          filePath: "packages/lib/src/a.ts",
          line: 1
        }
      ]
    });

    expect(first.contentHash).toBe(second.contentHash);

    expect(first.source.commitSha).toBe("abc123");
    expect(second.source.commitSha).toBe("def456");
    expect(first.source.branch).toBe("main");
    expect(second.source.branch).toBe("feature/reproducible");

    expect(first.files.find((file) => file.path === "packages/lib/src/a.ts")?.parseStatus).toBe(
      "parse-error"
    );
    expect(
      first.components.every((component) => component.id.startsWith("cmp:"))
    ).toBe(true);

    expect(architectureSnapshotSchema.parse(first).contentHash).toBe(first.contentHash);
  });
});
