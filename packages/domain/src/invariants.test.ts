import { describe, expect, it } from "vitest";

import type { ArchitectureSnapshot } from "./model.js";
import { validateSnapshotInvariants } from "./invariants.js";

function createValidSnapshot(): ArchitectureSnapshot {
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
        metrics: { fileCount: 1, loc: 10, fanIn: 0, fanOut: 0, instability: 0 }
      }
    ],
    files: [
      {
        id: "f-1",
        path: "src/index.ts",
        componentId: "root",
        role: "source",
        language: "ts",
        loc: 10,
        parseStatus: "parsed"
      }
    ],
    symbols: [],
    fileImports: [],
    dependencies: [],
    externalDependencies: [],
    cycles: [],
    resolutionStats: {
      countsByResolution: {},
      unresolvedRate: 0
    },
    diagnostics: []
  };
}

describe("validateSnapshotInvariants", () => {
  it("passes when component references are valid and file paths are unique", () => {
    const errors = validateSnapshotInvariants(createValidSnapshot());
    expect(errors).toEqual([]);
  });

  it("reports missing dependency and file component references", () => {
    const snapshot = createValidSnapshot();
    snapshot.files[0]!.componentId = "missing-component";
    snapshot.dependencies.push({
      id: "d-1",
      fromComponentId: "root",
      toComponentId: "missing-target",
      weight: 1,
      countsByKind: { static: 1 },
      countsByRole: { source: 1 },
      evidenceImportIds: []
    });

    const errors = validateSnapshotInvariants(snapshot);
    expect(errors.map((error) => error.code)).toEqual([
      "FILE_COMPONENT_MISSING",
      "DEPENDENCY_COMPONENT_MISSING"
    ]);
  });

  it("reports duplicate file paths", () => {
    const snapshot = createValidSnapshot();
    snapshot.files.push({
      id: "f-2",
      path: "src/index.ts",
      componentId: "root",
      role: "test",
      language: "ts",
      loc: 1,
      parseStatus: "parsed"
    });

    const errors = validateSnapshotInvariants(snapshot);
    expect(errors.map((error) => error.code)).toEqual(["DUPLICATE_FILE_PATH"]);
  });
});
