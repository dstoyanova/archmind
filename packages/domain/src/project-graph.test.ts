import { describe, expect, it, vi } from "vitest";

import * as invariants from "./invariants.js";
import type { ArchitectureSnapshot } from "./model.js";
import { createSnapshotProjector, projectGraph } from "./project-graph.js";

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

  it("omits components without files in the selected roles unless a dependency ends at them", () => {
    const snapshot = createSnapshot();
    snapshot.components.push({
      id: "d",
      name: "d",
      parentId: "pkg",
      depth: 2,
      kind: "folder",
      paths: ["packages/pkg/src/d"],
      metrics: { fileCount: 1, loc: 10, fanIn: 0, fanOut: 0, instability: 0 }
    });
    snapshot.files.push({
      id: "f-d",
      path: "packages/pkg/src/d/d.test.ts",
      componentId: "d",
      role: "test",
      language: "ts",
      loc: 10,
      parseStatus: "parsed"
    });
    const projector = createSnapshotProjector(snapshot);
    const componentIds = (filters: object) =>
      projector
        .projectGraph({ depth: 1, expanded: ["pkg"], filters })
        .components.map(({ id }) => id);

    expect(componentIds({ includeFileRoles: ["source"] })).toEqual([
      "root",
      "pkg",
      "a",
      "b",
      "c",
      "d"
    ]);
    // b has only test files but is the target of a source import; d is unreferenced.
    expect(componentIds({ includeFileRoles: ["source"], includeEmptyComponents: false })).toEqual([
      "root",
      "pkg",
      "a",
      "b",
      "c"
    ]);
    expect(componentIds({ includeFileRoles: ["test"], includeEmptyComponents: false })).toEqual([
      "root",
      "pkg",
      "b",
      "c",
      "d"
    ]);
    expect(componentIds({ includeEmptyComponents: false })).toEqual([
      "root",
      "pkg",
      "a",
      "b",
      "c",
      "d"
    ]);
    // No file has a story role, so nothing remains.
    expect(
      projector
        .projectGraph({
          depth: 1,
          filters: { includeFileRoles: ["story"], includeEmptyComponents: false }
        })
        .components.map(({ id }) => id)
    ).toEqual([]);
  });

  it("finds cycles after expansion and removes them under either role or type-only filters", () => {
    const snapshot = createSnapshot();
    snapshot.fileImports.push({
      id: "i-c-a",
      fromFileId: "f-c",
      toFileId: "f-a",
      specifier: "../a/a",
      kind: "static",
      resolution: "internal-file",
      line: 1,
      column: 1
    });
    snapshot.dependencies.push({
      id: "d-c-a",
      fromComponentId: "c",
      toComponentId: "a",
      weight: 1,
      countsByKind: { static: 1 },
      countsByRole: { source: 1 },
      evidenceImportIds: ["i-c-a"]
    });

    const projector = createSnapshotProjector(snapshot);
    const options = { depth: 1, expanded: ["pkg"] };

    expect(projector.projectGraph({ depth: 1 }).cycles).toEqual([]);
    expect(projector.projectGraph(options).cycles).toEqual([
      { memberIds: ["a", "b", "c"], typeOnly: true }
    ]);
    expect(
      projector.projectGraph({ ...options, filters: { includeFileRoles: ["source"] } }).cycles
    ).toEqual([]);
    expect(
      projector.projectGraph({ ...options, filters: { includeTypeOnly: false } }).cycles
    ).toEqual([]);
  });
});

describe("createSnapshotProjector", () => {
  it("validates once for repeated component and file projections", () => {
    const validate = vi.spyOn(invariants, "assertSnapshotInvariants");
    try {
      const projector = createSnapshotProjector(createSnapshot());
      projector.projectGraph({ depth: 1 });
      projector.projectGraph({ depth: 2 });
      projector.projectFileGraph("a", { depth: 1 });
      expect(validate).toHaveBeenCalledTimes(1);
    } finally {
      validate.mockRestore();
    }
  });

  it("rejects invalid snapshots before projecting", () => {
    const snapshot = createSnapshot();
    snapshot.files = [];
    expect(() => createSnapshotProjector(snapshot)).toThrow("IMPORT_REFERENCE_MISSING");
  });
});

describe("projectFileGraph", () => {
  it("keeps subtree imports as file edges and maps outgoing targets to visible components", () => {
    const snapshot = createSnapshot();
    const entryFile = {
      id: "f-pkg",
      path: "packages/pkg/index.ts",
      componentId: "pkg",
      role: "source",
      language: "ts",
      loc: 1,
      parseStatus: "parsed"
    } as const;
    snapshot.files.unshift(entryFile);
    snapshot.fileImports.push(
      {
        id: "i-pkg-a",
        fromFileId: entryFile.id,
        toFileId: "f-a",
        specifier: "./src/a/a",
        kind: "re-export",
        resolution: "internal-file",
        line: 1,
        column: 1
      },
      {
        id: "i-b-package",
        fromFileId: "f-b",
        toComponentId: "pkg",
        specifier: "pkg",
        kind: "static",
        resolution: "workspace-package",
        line: 3,
        column: 1
      },
      {
        id: "i-b-external",
        fromFileId: "f-b",
        externalPackage: "vitest",
        specifier: "vitest",
        kind: "static",
        resolution: "external-package",
        line: 1,
        column: 1
      }
    );
    const projector = createSnapshotProjector(snapshot);
    const subtree = projector.projectFileGraph("pkg", { depth: 1 });
    const collapsed = projector.projectFileGraph("b", { depth: 1 });
    const expanded = projector.projectFileGraph("b", { depth: 1, expanded: ["pkg"] });

    expect(subtree.files.map((file) => file.id)).toEqual(["f-pkg", "f-a", "f-b", "f-c"]);
    expect(subtree.imports.map(({ fileImport, target }) => [fileImport.id, target])).toEqual([
      ["i-a-b", { kind: "file", fileId: "f-b" }],
      ["i-b-c", { kind: "file", fileId: "f-c" }],
      ["i-b-package", { kind: "component", componentId: "pkg" }],
      ["i-pkg-a", { kind: "file", fileId: "f-a" }]
    ]);
    expect(collapsed.files.map((file) => file.id)).toEqual(["f-b"]);
    expect(collapsed.components.map((component) => component.id)).toEqual(["pkg"]);
    expect(collapsed.imports.map(({ target }) => target)).toEqual([
      { kind: "component", componentId: "pkg" },
      { kind: "component", componentId: "pkg" }
    ]);
    expect(expanded.components.map((component) => component.id)).toEqual(["pkg", "c"]);
    expect(expanded.imports[0]).toMatchObject({
      fileImport: { id: "i-b-c", line: 2, kind: "type-only" },
      target: { kind: "component", componentId: "c" }
    });
    expect(
      projector
        .projectFileGraph("b", { depth: 2, filters: { includeTypeOnly: false } })
        .imports.map(({ fileImport }) => fileImport.id)
    ).toEqual(["i-b-package"]);
    expect(
      projector.projectFileGraph("b", { depth: 2, filters: { includeFileRoles: ["source"] } })
        .imports
    ).toEqual([]);
  });

  it("rejects unknown components", () => {
    const projector = createSnapshotProjector(createSnapshot());
    expect(() => projector.projectFileGraph("missing", { depth: 1 })).toThrow(
      'unknown component "missing"'
    );
  });
});
