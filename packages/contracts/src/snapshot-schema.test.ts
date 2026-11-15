import { describe, expect, it } from "vitest";

import { architectureSnapshotSchema } from "./snapshot-schema.js";

function createValidSnapshot() {
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
  } as const;
}

describe("architectureSnapshotSchema", () => {
  it("accepts a valid snapshot", () => {
    const parsed = architectureSnapshotSchema.parse(createValidSnapshot());
    expect(parsed.contentHash).toBe("content");
  });

  it("rejects cross-reference invariant violations", () => {
    const invalidSnapshot = {
      ...createValidSnapshot(),
      dependencies: [
        {
          id: "dep-1",
          fromComponentId: "root",
          toComponentId: "missing",
          weight: 1,
          countsByKind: { static: 1 },
          countsByRole: { source: 1 },
          evidenceImportIds: []
        }
      ]
    };

    const result = architectureSnapshotSchema.safeParse(invalidSnapshot);
    expect(result.success).toBe(false);
  });
});
