import { archmindConfigSchema } from "@archmind/contracts";
import { describe, expect, it } from "vitest";

import { mapFilesToComponentHierarchy } from "./component-hierarchy-mapper.js";

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

describe("mapFilesToComponentHierarchy", () => {
  it("applies configured components, packages, folders and root ownership order", () => {
    const result = mapFilesToComponentHierarchy({
      analysisConfig: analysisConfig({
        components: [
          {
            name: "api-shared",
            paths: ["apps/api/src/shared/**"]
          }
        ]
      }),
      packageDirectories: ["apps/api", "packages/domain"],
      filePaths: [
        "README.md",
        "apps/api/src/shared/constants.ts",
        "apps/api/src/modules/users/service.ts",
        "apps/api/src/main.ts",
        "packages/domain/src/model.ts"
      ]
    });

    expect(result.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "root", kind: "root", depth: 0 }),
        expect.objectContaining({
          id: "configured:api-shared",
          kind: "configured"
        }),
        expect.objectContaining({
          id: "package:apps/api",
          kind: "package",
          depth: 1
        }),
        expect.objectContaining({
          id: "package:packages/domain",
          kind: "package",
          depth: 1
        }),
        expect.objectContaining({
          id: "folder:apps/api/src/modules",
          kind: "folder",
          depth: 2
        }),
        expect.objectContaining({
          id: "folder:apps/api/src/shared",
          kind: "folder"
        })
      ])
    );

    expect(result.ownership).toEqual([
      { filePath: "README.md", componentId: "root" },
      {
        filePath: "apps/api/src/main.ts",
        componentId: "package:apps/api"
      },
      {
        filePath: "apps/api/src/modules/users/service.ts",
        componentId: "folder:apps/api/src/modules"
      },
      {
        filePath: "apps/api/src/shared/constants.ts",
        componentId: "configured:api-shared"
      },
      {
        filePath: "packages/domain/src/model.ts",
        componentId: "package:packages/domain"
      }
    ]);
  });

  it("creates folder children from componentRoots overrides and maps each file once", () => {
    const result = mapFilesToComponentHierarchy({
      analysisConfig: analysisConfig({
        componentRoots: {
          "apps/api": "src/modules"
        }
      }),
      packageDirectories: ["apps/api"],
      filePaths: [
        "apps/api/src/modules/auth/auth.module.ts",
        "apps/api/src/modules/billing/service.ts",
        "apps/api/src/main.ts",
        "apps/api/package.json"
      ]
    });

    expect(
      result.components
        .filter((component) => component.kind === "folder")
        .map((component) => component.paths[0])
    ).toEqual(["apps/api/src/modules/auth", "apps/api/src/modules/billing"]);

    const ownershipPaths = result.ownership.map((item) => item.filePath);
    expect(new Set(ownershipPaths).size).toBe(ownershipPaths.length);
    expect(ownershipPaths).toEqual([
      "apps/api/package.json",
      "apps/api/src/main.ts",
      "apps/api/src/modules/auth/auth.module.ts",
      "apps/api/src/modules/billing/service.ts"
    ]);
  });

  it("does not create folder components from files owned by nested packages", () => {
    const result = mapFilesToComponentHierarchy({
      analysisConfig: analysisConfig(),
      packageDirectories: [".", "packages/a"],
      filePaths: ["package.json", "packages/a/package.json", "packages/a/src/x/y.ts"]
    });

    const folderPaths = result.components
      .filter((component) => component.kind === "folder")
      .map((component) => component.paths[0]);
    expect(folderPaths).toEqual(["packages/a/src/x"]);
    expect(folderPaths).not.toContain("packages");
  });

  it("keeps configured component IDs independent of config order", () => {
    const components = [
      { name: "a", paths: ["a/**"] },
      { name: "b", paths: ["b/**"] }
    ];
    const idsFor = (ordered: typeof components) =>
      mapFilesToComponentHierarchy({
        analysisConfig: analysisConfig({ components: ordered }),
        packageDirectories: [],
        filePaths: ["a/x.ts", "b/y.ts"]
      }).ownership;

    expect(idsFor(components)).toEqual(idsFor([...components].reverse()));
  });

  it("reports unknown and cyclic configured parents and attaches them to the root", () => {
    const result = mapFilesToComponentHierarchy({
      analysisConfig: analysisConfig({
        components: [
          { name: "orphan", paths: ["orphan/**"], parent: "missing" },
          { name: "child-of-orphan", paths: ["child/**"], parent: "orphan" },
          { name: "loop-a", paths: ["a/**"], parent: "loop-b" },
          { name: "loop-b", paths: ["b/**"], parent: "loop-a" }
        ]
      }),
      packageDirectories: [],
      filePaths: ["orphan/x.ts", "child/x.ts", "a/x.ts", "b/x.ts"]
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "CONFIG_COMPONENT_PARENT_CYCLE",
      "CONFIG_COMPONENT_PARENT_UNKNOWN"
    ]);
    const parentOf = (id: string) =>
      result.components.find((component) => component.id === id)?.parentId;
    expect(parentOf("configured:orphan")).toBe("root");
    expect(parentOf("configured:child-of-orphan")).toBe("configured:orphan");
    expect(parentOf("configured:loop-a")).toBe("root");
    expect(parentOf("configured:loop-b")).toBe("configured:loop-a");
  });
});
