import { describe, expect, it } from "vitest";

import {
  buildGraphMetricsAndCycles,
  type BuildGraphMetricsAndCyclesInput
} from "./graph-metrics-cycles.js";

describe("buildGraphMetricsAndCycles", () => {
  it("builds dependencies, metrics, file cycles and external dependencies", () => {
    const files: BuildGraphMetricsAndCyclesInput["files"] = [
      createFile("f-a-src", "packages/pkg/src/a.ts", "a", "source", 10),
      createFile("f-b-src", "packages/pkg/src/b.ts", "b", "source", 20),
      createFile("f-c-src", "packages/pkg/src/c.ts", "c", "source", 30),
      createFile("f-a-test-1", "packages/pkg/src/a.test.ts", "a", "test", 5),
      createFile("f-a-test-2", "packages/pkg/src/a.spec.ts", "a", "test", 5)
    ];

    const fileImports: BuildGraphMetricsAndCyclesInput["fileImports"] = [
      createInternalImport("i-a-b-static", "f-a-src", "f-b-src", "static"),
      createInternalImport("i-b-a-type", "f-b-src", "f-a-src", "type-only"),
      createInternalImport("i-b-c-static", "f-b-src", "f-c-src", "static"),
      createInternalImport("i-a-test-cycle-1", "f-a-test-1", "f-a-test-2", "static"),
      createInternalImport("i-a-test-cycle-2", "f-a-test-2", "f-a-test-1", "static"),
      createExternalImport("i-a-react", "f-a-src", "react"),
      createExternalImport("i-a-vitest", "f-a-test-1", "vitest")
    ];

    const result = buildGraphMetricsAndCycles({
      components: createComponents(),
      files,
      fileImports
    });

    expect(result.dependencies).toEqual([
      {
        id: "dep:a->b",
        fromComponentId: "a",
        toComponentId: "b",
        weight: 1,
        countsByKind: { static: 1 },
        countsByRole: { source: 1 },
        evidenceImportIds: ["i-a-b-static"]
      },
      {
        id: "dep:b->a",
        fromComponentId: "b",
        toComponentId: "a",
        weight: 1,
        countsByKind: { "type-only": 1 },
        countsByRole: { source: 1 },
        evidenceImportIds: ["i-b-a-type"]
      },
      {
        id: "dep:b->c",
        fromComponentId: "b",
        toComponentId: "c",
        weight: 1,
        countsByKind: { static: 1 },
        countsByRole: { source: 1 },
        evidenceImportIds: ["i-b-c-static"]
      }
    ]);

    expect(result.externalDependencies).toEqual([
      {
        componentId: "a",
        packageName: "react",
        weight: 1,
        countsByRole: { source: 1 }
      },
      {
        componentId: "a",
        packageName: "vitest",
        weight: 1,
        countsByRole: { test: 1 }
      }
    ]);

    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "root",
          metrics: { fileCount: 5, loc: 70, fanIn: 0, fanOut: 0, instability: 0 }
        }),
        expect.objectContaining({
          id: "pkg",
          metrics: { fileCount: 5, loc: 70, fanIn: 0, fanOut: 0, instability: 0 }
        }),
        expect.objectContaining({
          id: "a",
          metrics: { fileCount: 3, loc: 20, fanIn: 1, fanOut: 1, instability: 0.5 }
        }),
        expect.objectContaining({
          id: "b",
          metrics: {
            fileCount: 1,
            loc: 20,
            fanIn: 1,
            fanOut: 2,
            instability: 2 / 3
          }
        }),
        expect.objectContaining({
          id: "c",
          metrics: { fileCount: 1, loc: 30, fanIn: 1, fanOut: 0, instability: 0 }
        })
      ])
    );

    expect(result.cycles).toContainEqual({
      level: { kind: "depth", depth: 2 },
      memberIds: ["a", "b"],
      typeOnly: true
    });
    expect(result.cycles).toContainEqual({
      level: { kind: "file" },
      memberIds: ["f-a-src", "f-b-src"],
      typeOnly: true
    });
    expect(
      result.cycles.some(
        (cycle) =>
          cycle.memberIds.includes("f-a-test-1") || cycle.memberIds.includes("f-a-test-2")
      )
    ).toBe(false);
  });

  it("finds Tarjan cycles at each hierarchy level", () => {
    const files: BuildGraphMetricsAndCyclesInput["files"] = [
      createFile("f-a", "packages/pkg-a/src/a.ts", "pkg-a:domain", "source", 5),
      createFile("f-b", "packages/pkg-b/src/b.ts", "pkg-b:domain", "source", 5)
    ];
    const fileImports: BuildGraphMetricsAndCyclesInput["fileImports"] = [
      createInternalImport("i-a-b", "f-a", "f-b", "static"),
      createInternalImport("i-b-a", "f-b", "f-a", "static")
    ];
    const components = [
      {
        id: "root",
        name: "<root>",
        depth: 0,
        kind: "root" as const,
        paths: ["."]
      },
      {
        id: "pkg-a",
        name: "pkg-a",
        parentId: "root",
        depth: 1,
        kind: "package" as const,
        paths: ["packages/pkg-a"]
      },
      {
        id: "pkg-b",
        name: "pkg-b",
        parentId: "root",
        depth: 1,
        kind: "package" as const,
        paths: ["packages/pkg-b"]
      },
      {
        id: "pkg-a:domain",
        name: "domain",
        parentId: "pkg-a",
        depth: 2,
        kind: "folder" as const,
        paths: ["packages/pkg-a/src/domain"]
      },
      {
        id: "pkg-b:domain",
        name: "domain",
        parentId: "pkg-b",
        depth: 2,
        kind: "folder" as const,
        paths: ["packages/pkg-b/src/domain"]
      }
    ];

    const result = buildGraphMetricsAndCycles({
      components,
      files,
      fileImports
    });

    expect(result.cycles).toEqual(
      expect.arrayContaining([
        {
          level: { kind: "depth", depth: 1 },
          memberIds: ["pkg-a", "pkg-b"],
          typeOnly: false
        },
        {
          level: { kind: "depth", depth: 2 },
          memberIds: ["pkg-a:domain", "pkg-b:domain"],
          typeOnly: false
        },
        {
          level: { kind: "file" },
          memberIds: ["f-a", "f-b"],
          typeOnly: false
        }
      ])
    );
  });
  it("keeps edges from files owned directly by a package in depth cycles and metrics", () => {
    const components = [
      { id: "root", name: "<root>", depth: 0, kind: "root" as const, paths: ["."] },
      {
        id: "pkg",
        name: "pkg",
        parentId: "root",
        depth: 1,
        kind: "package" as const,
        paths: ["packages/pkg"]
      },
      {
        id: "feature",
        name: "feature",
        parentId: "pkg",
        depth: 2,
        kind: "folder" as const,
        paths: ["packages/pkg/src/feature"]
      },
      {
        id: "other",
        name: "other",
        parentId: "pkg",
        depth: 2,
        kind: "folder" as const,
        paths: ["packages/pkg/src/other"]
      }
    ];

    const result = buildGraphMetricsAndCycles({
      components,
      files: [
        createFile("f-barrel", "packages/pkg/src/index.ts", "pkg", "source", 1),
        createFile("f-feature", "packages/pkg/src/feature/a.ts", "feature", "source", 1),
        createFile("f-other", "packages/pkg/src/other/b.ts", "other", "source", 1)
      ],
      fileImports: [
        createInternalImport("i-barrel-feature", "f-barrel", "f-feature", "static"),
        createInternalImport("i-feature-barrel", "f-feature", "f-barrel", "static"),
        createInternalImport("i-other-barrel", "f-other", "f-barrel", "static")
      ]
    });

    expect(result.cycles).toContainEqual({
      level: { kind: "depth", depth: 2 },
      memberIds: ["feature", "pkg"],
      typeOnly: false
    });
    expect(result.components.find((component) => component.id === "feature")?.metrics).toMatchObject({
      fanIn: 1,
      fanOut: 1
    });
    expect(result.components.find((component) => component.id === "other")?.metrics).toMatchObject({
      fanIn: 0,
      fanOut: 1
    });
  });
});

function createComponents() {
  return [
    {
      id: "root",
      name: "<root>",
      depth: 0,
      kind: "root" as const,
      paths: ["."]
    },
    {
      id: "pkg",
      name: "pkg",
      parentId: "root",
      depth: 1,
      kind: "package" as const,
      paths: ["packages/pkg"]
    },
    {
      id: "a",
      name: "a",
      parentId: "pkg",
      depth: 2,
      kind: "folder" as const,
      paths: ["packages/pkg/src/a"]
    },
    {
      id: "b",
      name: "b",
      parentId: "pkg",
      depth: 2,
      kind: "folder" as const,
      paths: ["packages/pkg/src/b"]
    },
    {
      id: "c",
      name: "c",
      parentId: "pkg",
      depth: 2,
      kind: "folder" as const,
      paths: ["packages/pkg/src/c"]
    }
  ];
}

function createFile(
  id: string,
  filePath: string,
  componentId: string,
  role: BuildGraphMetricsAndCyclesInput["files"][number]["role"],
  loc: number
): BuildGraphMetricsAndCyclesInput["files"][number] {
  return {
    id,
    path: filePath,
    componentId,
    role,
    language: "ts",
    loc,
    parseStatus: "parsed"
  };
}

function createInternalImport(
  id: string,
  fromFileId: string,
  toFileId: string,
  kind: BuildGraphMetricsAndCyclesInput["fileImports"][number]["kind"]
): BuildGraphMetricsAndCyclesInput["fileImports"][number] {
  return {
    id,
    fromFileId,
    specifier: `./${toFileId}`,
    kind,
    resolution: "internal-file",
    toFileId,
    line: 1,
    column: 1
  };
}

function createExternalImport(
  id: string,
  fromFileId: string,
  packageName: string
): BuildGraphMetricsAndCyclesInput["fileImports"][number] {
  return {
    id,
    fromFileId,
    specifier: packageName,
    kind: "static",
    resolution: "external-package",
    externalPackage: packageName,
    line: 1,
    column: 1
  };
}
