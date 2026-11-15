import { describe, expect, it } from "vitest";

import { archmindConfigSchema } from "./config-schema.js";

describe("archmindConfigSchema", () => {
  it("applies defaults for the analysis section", () => {
    const parsed = archmindConfigSchema.parse({});
    expect(parsed.analysis).toEqual({
      components: [],
      componentRoots: {},
      fileRoles: {}
    });
  });

  it("validates configured components and role overrides", () => {
    const parsed = archmindConfigSchema.parse({
      analysis: {
        components: [
          {
            name: "api",
            paths: ["apps/api/src/**"],
            parent: "root"
          }
        ],
        componentRoots: {
          "apps/api": "src/modules"
        },
        fileRoles: {
          test: ["**/*.spec.ts"]
        }
      }
    });

    expect(parsed.analysis.components).toHaveLength(1);
    expect(parsed.analysis.fileRoles.test).toEqual(["**/*.spec.ts"]);
  });
});
