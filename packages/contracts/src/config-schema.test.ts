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
            paths: ["apps/api/src/**"]
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

  it("rejects unknown analysis keys such as a misspelled componentRoots", () => {
    const result = archmindConfigSchema.safeParse({
      analysis: { componentRoot: { "apps/api": "src" } }
    });

    expect(result.success).toBe(false);
  });

  it("accepts exclusion globs but rejects blank patterns and non-list values", () => {
    expect(
      archmindConfigSchema.parse({ analysis: { exclude: ["fixtures/**"] } }).analysis.exclude
    ).toEqual(["fixtures/**"]);
    for (const exclude of ["fixtures/**", ["  "]]) {
      expect(archmindConfigSchema.safeParse({ analysis: { exclude } }).success).toBe(false);
    }
  });

  it("rejects a source file role override", () => {
    const result = archmindConfigSchema.safeParse({
      analysis: { fileRoles: { source: ["src/**"] } }
    });

    expect(result.success).toBe(false);
  });

  it("rejects duplicate component names", () => {
    const result = archmindConfigSchema.safeParse({
      analysis: {
        components: [
          { name: "api", paths: ["a/**"] },
          { name: "api", paths: ["b/**"] }
        ]
      }
    });

    expect(result.success).toBe(false);
  });

  it("normalises componentRoots keys", () => {
    const parsed = archmindConfigSchema.parse({
      analysis: { componentRoots: { "./apps/api/": "./src/modules/" } }
    });

    expect(parsed.analysis.componentRoots).toEqual({ "apps/api": "src/modules" });
  });
});
