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
          id: "configured:0:api-shared",
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
        componentId: "configured:0:api-shared"
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
});
