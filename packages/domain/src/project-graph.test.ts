import { describe, expect, it } from "vitest";

import type { ArchitectureSnapshot } from "./model.js";
import { projectGraph } from "./project-graph.js";

function createSnapshot(): ArchitectureSnapshot {
  return {
    schemaVersion: "1",
    engineVersion: "1",
    parserVersion: "1",
    analysisConfigHash: "analysis",
    contentHash: "content",
    source: {
      kind: "local",
      sourceHash: "source"
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    components: [
      {
        id: "root",
        name: "<root>",
        depth: 0,
        kind: "root",
        paths: ["."],
        metrics: { fileCount: 3, loc: 30, fanIn: 0, fanOut: 0, instability: 0 }
      },
      {
        id: "pkg",
        name: "pkg",
        parentId: "root",
        depth: 1,
        kind: "package",
        paths: ["packages/pkg"],
        metrics: { fileCount: 3, loc: 30, fanIn: 0, fanOut: 0, instability: 0 }
      },
      {
        id: "a",
        name: "a",
        parentId: "pkg",
        depth: 2,
        kind: "folder",
        paths: ["packages/pkg/src/a"],
        metrics: { fileCount: 1, loc: 10, fanIn: 0, fanOut: 0, instability: 0 }
      },
      {
        id: "b",
        name: "b",
        parentId: "pkg",
        depth: 2,
        kind: "folder",
        paths: ["packages/pkg/src/b"],
        metrics: { fileCount: 1, loc: 10, fanIn: 0, fanOut: 0, instability: 0 }
      },
      {
        id: "c",
        name: "c",
        parentId: "pkg",
        depth: 2,
        kind: "folder",
        paths: ["packages/pkg/src/c"],
        metrics: { fileCount: 1, loc: 10, fanIn: 0, fanOut: 0, instability: 0 }
      }
    ],
    files: [
      {
        id: "f-a",
        path: "packages/pkg/src/a/a.ts",
        componentId: "a",
        role: "source",
        language: "ts",
        loc: 10,
        parseStatus: "parsed"
      },
      {
        id: "f-b",
        path: "packages/pkg/src/b/b.test.ts",
        componentId: "b",
        role: "test",
        language: "ts",
        loc: 10,
        parseStatus: "parsed"
      },
      {
        id: "f-c",
        path: "packages/pkg/src/c/c.ts",
        componentId: "c",
        role: "source",
        language: "ts",
        loc: 10,
        parseStatus: "parsed"
      }
    ],
    symbols: [],
    fileImports: [
      {
        id: "i-a-b",
        fromFileId: "f-a",
        specifier: "../b/b",
        kind: "static",
        resolution: "internal-file",
        toFileId: "f-b",
        toComponentId: "b",
        line: 1,
        column: 1
      },
      {
        id: "i-b-c",
        fromFileId: "f-b",
        specifier: "../c/c",
        kind: "type-only",
        resolution: "internal-file",
        toFileId: "f-c",
        toComponentId: "c",
        line: 2,
        column: 1
      }
    ],
    dependencies: [
      {
        id: "d-a-b",
        fromComponentId: "a",
        toComponentId: "b",
        weight: 1,
        countsByKind: { static: 1 },
        countsByRole: { source: 1 },
        evidenceImportIds: ["i-a-b"]
      },
      {
        id: "d-b-c",
        fromComponentId: "b",
        toComponentId: "c",
        weight: 1,
        countsByKind: { "type-only": 1 },
        countsByRole: { test: 1 },
        evidenceImportIds: ["i-b-c"]
      }
    ],
    externalDependencies: [
      {
        componentId: "a",
        packageName: "zod",
        weight: 1,
        countsByRole: { source: 1 }
      },
      {
        componentId: "b",
        packageName: "vitest",
        weight: 1,
        countsByRole: { test: 1 }
      }
    ],
    cycles: [],
    resolutionStats: {
      countsByResolution: { "internal-file": 2 },
      unresolvedRate: 0
    },
    diagnostics: []
  };
}

describe("projectGraph", () => {
  it("collapses dependencies to the requested depth and drops internal edges", () => {
    const snapshot = createSnapshot();
    const graph = projectGraph(snapshot, { depth: 1 });

    expect(graph.components.map((component) => component.id)).toEqual(["root", "pkg"]);
    expect(graph.dependencies).toHaveLength(0);
    expect(graph.externalDependencies).toEqual([
      {
        componentId: "pkg",
        packageName: "vitest",
        weight: 1,
        countsByRole: { test: 1 }
      },
      {
        componentId: "pkg",
        packageName: "zod",
        weight: 1,
        countsByRole: { source: 1 }
      }
    ]);
  });

  it("expands selected components and aggregates projected dependency data", () => {
    const snapshot = createSnapshot();
    const graph = projectGraph(snapshot, { depth: 1, expanded: ["pkg"] });

    expect(graph.components.map((component) => component.id)).toEqual([
      "root",
      "pkg",
      "a",
      "b",
      "c"
    ]);
    expect(graph.dependencies).toEqual([
      {
        fromComponentId: "a",
        toComponentId: "b",
        weight: 1,
        countsByKind: { static: 1 },
        countsByRole: { source: 1 },
        evidenceImportIds: ["i-a-b"]
      },
      {
        fromComponentId: "b",
        toComponentId: "c",
        weight: 1,
        countsByKind: { "type-only": 1 },
        countsByRole: { test: 1 },
        evidenceImportIds: ["i-b-c"]
      }
    ]);
  });

  it("applies role and type-only filters during projection", () => {
    const snapshot = createSnapshot();
    const graph = projectGraph(snapshot, {
      depth: 1,
      expanded: ["pkg"],
      filters: {
        includeFileRoles: ["source"],
        includeTypeOnly: false
      }
    });

    expect(graph.dependencies).toEqual([
      {
        fromComponentId: "a",
        toComponentId: "b",
        weight: 1,
        countsByKind: { static: 1 },
        countsByRole: { source: 1 },
        evidenceImportIds: ["i-a-b"]
      }
    ]);
    expect(graph.externalDependencies).toEqual([
      {
        componentId: "a",
        packageName: "zod",
        weight: 1,
        countsByRole: { source: 1 }
      }
    ]);
  });
});
