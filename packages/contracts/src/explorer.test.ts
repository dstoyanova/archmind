import { createSnapshotProjector } from "@archmind/domain";
import { describe, expect, it } from "vitest";

import {
  findProjectedDependency,
  toComponentDetail,
  toComponentGraph,
  toDependencyEvidence,
  toFileGraph,
  toProjectGraphOptions,
  toSnapshotListItem,
  toSnapshotOverview
} from "./explorer-mappings.js";
import { createExplorerOpenApiDocument } from "./explorer-openapi.js";
import {
  componentDetailSchema,
  dependencyEvidencePageSchema,
  dependencyEvidenceQuerySchema,
  graphQuerySchema,
  graphResponseSchema,
  snapshotListSchema,
  snapshotOverviewSchema
} from "./explorer-schema.js";
import { architectureSnapshotSchema } from "./snapshot-schema.js";

function createSnapshot() {
  const metrics = { fileCount: 1, loc: 10, fanIn: 1, fanOut: 1, instability: 0.5 };
  return architectureSnapshotSchema.parse({
    schemaVersion: "1",
    engineVersion: "1",
    parserVersion: "1",
    analysisConfigHash: "analysis",
    contentHash: "shared-hash",
    source: { kind: "local", sourceHash: "source", branch: "main" },
    createdAt: "2026-01-01T00:00:00.000Z",
    components: [
      { id: "root", name: "<root>", depth: 0, kind: "root", paths: ["."], metrics },
      ...["a", "b"].map((id) => ({
        id,
        name: id,
        parentId: "root",
        depth: 1,
        kind: "package",
        paths: [`packages/${id}`],
        metrics
      }))
    ],
    files: ["a", "b"].map((id) => ({
      id: `${id}.ts`,
      componentId: id,
      path: `packages/${id}/index.ts`,
      role: "source",
      language: "ts",
      loc: 10,
      parseStatus: "parsed"
    })),
    symbols: [],
    fileImports: [
      { id: "a-b", fromFileId: "a.ts", toFileId: "b.ts", specifier: "b", kind: "type-only" },
      { id: "b-a", fromFileId: "b.ts", toFileId: "a.ts", specifier: "a", kind: "static" }
    ].map((item) => ({ ...item, resolution: "internal-file", line: 2, column: 3 })),
    dependencies: [
      { id: "a-b", fromComponentId: "a", toComponentId: "b", countsByKind: { "type-only": 1 } },
      { id: "b-a", fromComponentId: "b", toComponentId: "a", countsByKind: { static: 1 } }
    ].map((item) => ({
      ...item,
      evidenceImportIds: [item.id],
      weight: 1,
      countsByRole: { source: 1 }
    })),
    externalDependencies: [
      { componentId: "a", packageName: "zod", weight: 1, countsByRole: { source: 1 } }
    ],
    cycles: [{ level: { kind: "depth", depth: 1 }, memberIds: ["a", "b"], typeOnly: true }],
    resolutionStats: { countsByResolution: { "internal-file": 2 }, unresolvedRate: 0 },
    diagnostics: [{ severity: "warning", code: "EXAMPLE", message: "Example diagnostic" }]
  });
}

describe("explorer queries", () => {
  it("normalizes the same HTTP projection options for graphs and endpoint-based evidence", () => {
    const params = { depth: "2", expand: ["a", "b"], roles: "test", includeTypeOnly: "false" };
    const graph = graphQuerySchema.parse(params);
    const evidence = dependencyEvidenceQuerySchema.parse({
      ...params,
      from: "a",
      to: "b",
      cursor: "opaque",
      limit: "5"
    });

    expect(toProjectGraphOptions(graph)).toEqual({
      depth: 2,
      expanded: ["a", "b"],
      filters: { includeFileRoles: ["test"], includeTypeOnly: false, includeEmptyComponents: true }
    });
    expect(toProjectGraphOptions(evidence)).toEqual(toProjectGraphOptions(graph));
    expect(evidence).toMatchObject({ from: "a", to: "b", cursor: "opaque", limit: 5 });
  });

  it.each([
    { includeTypeOnly: "0" },
    { includeEmptyComponents: "no" },
    { depth: "" },
    { roles: "unknown" },
    { level: "file" },
    { level: "component", componentId: "a" }
  ])("rejects malformed or contradictory graph options: %j", (params) => {
    expect(graphQuerySchema.safeParse(params).success).toBe(false);
  });

  it("accepts 128 expansions and rejects 129 in graph and evidence projections", () => {
    const expand = Array.from({ length: 128 }, (_, index) => `component-${index}`);
    expect(graphQuerySchema.parse({ expand }).expand).toEqual(expand);
    const oversized = [...expand, "extra"];
    expect(() => graphQuerySchema.parse({ expand: oversized })).toThrow(
      "At most 128 expand values are allowed."
    );
    expect(
      dependencyEvidenceQuerySchema.safeParse({ expand: oversized, from: "a", to: "b" }).success
    ).toBe(false);
  });
});

describe("explorer mappings", () => {
  it("identifies equal-content snapshots independently and keeps diagnostics out of the overview", () => {
    const snapshot = createSnapshot();
    const first = { id: "first", label: "first.json" };
    const second = { id: "second", label: "second.json" };
    const list = {
      items: [toSnapshotListItem(first, snapshot), toSnapshotListItem(second, snapshot)],
      nextCursor: null
    };
    const overview = toSnapshotOverview(first, snapshot);

    expect(snapshotListSchema.parse(list)).toEqual(list);
    expect(list.items.map(({ id, contentHash }) => [id, contentHash])).toEqual([
      ["first", "shared-hash"],
      ["second", "shared-hash"]
    ]);
    expect(snapshotOverviewSchema.parse(overview)).toEqual(overview);
    expect(overview).toMatchObject({
      diagnosticCount: 1,
      diagnosticCountsByCode: { EXAMPLE: 1 },
      fileCount: 2,
      componentCount: 3
    });
    expect(overview).not.toHaveProperty("diagnostics");
  });

  it("maps projected cycles, external totals and edge counts without exposing evidence IDs", () => {
    const projector = createSnapshotProjector(createSnapshot());
    const view = (params: object) =>
      toComponentGraph(
        projector.projectGraph(toProjectGraphOptions(graphQuerySchema.parse(params)))
      );
    const graph = view({});
    const runtimeOnly = view({ includeTypeOnly: "false" });

    expect(graphResponseSchema.parse(graph)).toEqual(graph);
    expect(graph.cycles).toEqual([{ memberIds: ["a", "b"], typeOnly: true }]);
    expect(runtimeOnly.cycles).toEqual([]);
    expect(runtimeOnly.components).toEqual(graph.components);
    expect(graph.dependencies[0]).toEqual({
      fromComponentId: "a",
      toComponentId: "b",
      weight: 1,
      countsByKind: { "type-only": 1 },
      countsByRole: { source: 1 }
    });
    expect(graph.externalDependencies).toEqual([
      { componentId: "a", packageName: "zod", weight: 1, countsByRole: { source: 1 } }
    ]);
  });

  it("maps file drill-down, component detail, and only the requested evidence records", () => {
    const snapshot = createSnapshot();
    const projector = createSnapshotProjector(snapshot);
    const query = graphQuerySchema.parse({ level: "file", componentId: "a" });
    const options = toProjectGraphOptions(query);
    const fileGraph = toFileGraph(projector.projectFileGraph("a", options));
    const graph = projector.projectGraph(options);
    const component = snapshot.components.find(({ id }) => id === "a");
    const edge = findProjectedDependency(graph, { from: "a", to: "b" });
    expect(component).toBeDefined();
    expect(edge).toBeDefined();
    if (!component || !edge) throw new Error("Missing test fixture component or edge");

    const detail = toComponentDetail(component, snapshot.components, graph);
    expect(componentDetailSchema.parse(detail)).toEqual(detail);
    expect(detail.inboundDependencies[0]?.fromComponentId).toBe("b");
    expect(detail.outboundDependencies[0]?.toComponentId).toBe("b");
    expect(graphResponseSchema.parse(fileGraph)).toEqual(fileGraph);
    expect(fileGraph.imports).toEqual([
      {
        fromFileId: "a.ts",
        target: { kind: "component", componentId: "b" },
        specifier: "b",
        kind: "type-only",
        line: 2,
        column: 3
      }
    ]);

    const evidence = toDependencyEvidence(
      edge.evidenceImportIds,
      new Map(snapshot.fileImports.map((item) => [item.id, item])),
      new Map(snapshot.files.map((file) => [file.id, file]))
    );
    expect(dependencyEvidencePageSchema.parse({ items: evidence, nextCursor: null }).items).toEqual(
      [
        {
          filePath: "packages/a/index.ts",
          specifier: "b",
          kind: "type-only",
          role: "source",
          line: 2,
          column: 3
        }
      ]
    );
  });
});

describe("explorer OpenAPI", () => {
  it("documents graph and evidence wire parameters and uses the shared error envelope", () => {
    const document = createExplorerOpenApiDocument();
    const base = "/api/workspaces/{workspaceId}/snapshots";
    const graph = document.paths?.[`${base}/{id}/graph`]?.get;
    const evidence = document.paths?.[`${base}/{id}/dependencies`]?.get;

    expect(Object.keys(document.paths ?? {})).toHaveLength(12);
    const workspace = "/api/workspaces/{workspaceId}";
    expect(document.paths).toMatchObject({
      [`${base}/{id}/evaluations`]: { get: { operationId: "listEvaluations" } },
      [`${workspace}/evaluations/{id}`]: { get: { operationId: "getEvaluation" } },
      [`${workspace}/evaluations/{id}/findings`]: { get: { operationId: "listFindings" } },
      [`${workspace}/evaluations/{id}/findings/{findingId}`]: {
        get: { operationId: "getFinding" }
      },
      [`${workspace}/evaluations/{id}/health`]: { get: { operationId: "getEvaluationHealth" } }
    });
    expect(graph?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "roles",
          required: false,
          schema: expect.objectContaining({ default: ["source"] })
        }),
        expect.objectContaining({
          name: "includeTypeOnly",
          required: false,
          schema: { type: "boolean", default: true }
        })
      ])
    );
    expect(evidence?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "from", required: true }),
        expect.objectContaining({ name: "to", required: true }),
        expect.objectContaining({ name: "cursor", required: false })
      ])
    );
    expect(graph?.responses?.["404"]).toMatchObject({
      content: { "application/json": { schema: { $ref: "#/components/schemas/ExplorerError" } } }
    });
  });
});
