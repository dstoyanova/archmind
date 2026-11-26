import { describe, expect, it } from "vitest";

import { archmindConfigSchema } from "./config-schema.js";
import { computeRulesHash } from "./rules-hash.js";
import {
  componentSelectorSchema,
  enabledDefaultRuleIds,
  rulesConfigSchema
} from "./rules-schema.js";

const threshold = {
  id: "coupling",
  type: "threshold",
  severity: "warning",
  components: [{ path: "apps/api/src/modules/*" }],
  metric: "fanOut",
  max: 10
};
const forbidden = {
  id: "web-boundary",
  type: "forbidden-dependency",
  severity: "error",
  from: [{ path: "apps/web" }],
  to: [{ name: "api" }]
};
const layers = [
  { name: "app", components: [{ path: "apps/*" }] },
  { name: "domain", components: [{ name: "domain" }] }
];

describe("governance rule configuration", () => {
  it("parses all rule types and applies scope defaults only to graph rules", () => {
    const rules = rulesConfigSchema.parse({
      definitions: [
        threshold,
        forbidden,
        { id: "layering", type: "layers", severity: "error", layers },
        { id: "cycles", type: "no-cycles", severity: "warning", components: [{ path: "apps/**" }] },
        {
          id: "storage",
          type: "restricted-package",
          severity: "error",
          packages: ["@vendor/database"],
          allow: [],
          scope: { additionalFileRoles: ["test", "script"], includeTypeOnly: false }
        }
      ]
    });

    expect(rules.definitions).toContainEqual(threshold);
    expect(rules.definitions.find((rule) => rule.id === "cycles")).toMatchObject({
      includeTypeOnlyCycles: false,
      scope: { additionalFileRoles: [], includeTypeOnly: true }
    });
    expect(rules.definitions.find((rule) => rule.id === "storage")).toMatchObject({
      scope: { additionalFileRoles: ["script", "test"], includeTypeOnly: false }
    });
  });

  it("accepts only explicit path or configured-name selectors", () => {
    expect(componentSelectorSchema.parse({ path: "./apps/*/" })).toEqual({ path: "apps/*" });
    for (const selector of [
      "api",
      { displayName: "api" },
      { path: "apps/api", name: "api" },
      { path: "/" },
      { path: "apps/../api" },
      { path: "C:/api" }
    ]) {
      expect(componentSelectorSchema.safeParse(selector).success).toBe(false);
    }
  });

  it("accepts Node.js built-ins by their node: name only in restricted-package names", () => {
    const restricted = (packages: string[]) =>
      rulesConfigSchema.safeParse({
        definitions: [
          { id: "no-fs", type: "restricted-package", severity: "error", packages, allow: [] }
        ]
      }).success;
    expect(restricted(["node:fs", "node:fs/promises", "@vendor/database"])).toBe(true);
    expect(restricted(["node:"])).toBe(false);
    expect(restricted(["node:fs/"])).toBe(false);
  });

  it.each([
    { definitions: [threshold, { ...threshold, id: " coupling " }], id: "coupling", field: "id" },
    { definitions: [{ ...threshold, max: -1 }], id: "coupling", field: "max" },
    { definitions: [{ ...threshold, metric: "files" }], id: "coupling", field: "metric" },
    { definitions: [{ ...threshold, scope: {} }], id: "coupling", field: "scope" },
    {
      definitions: [{ ...forbidden, scope: { additionalFileRoles: ["source"] } }],
      id: "web-boundary",
      field: "scope.additionalFileRoles.0"
    }
  ])("reports rule $id and field $field", ({ definitions, id, field }) => {
    const result = archmindConfigSchema.safeParse({ rules: { definitions } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(`Rule "${id}"`);
      expect(result.error.issues[0]?.message).toContain(field);
    }
  });

  it("keeps defaults enabled when custom rules are configured and disables only listed defaults", () => {
    expect(enabledDefaultRuleIds(rulesConfigSchema.parse({ definitions: [threshold] }))).toEqual([
      "archmind/no-cycles",
      "archmind/high-coupling"
    ]);
    expect(
      enabledDefaultRuleIds(rulesConfigSchema.parse({ disableDefaults: ["archmind/no-cycles"] }))
    ).toEqual(["archmind/high-coupling"]);
    expect(rulesConfigSchema.safeParse({ disableDefaults: ["coupling"] }).success).toBe(false);
    expect(
      rulesConfigSchema.safeParse({ definitions: [{ ...threshold, id: "archmind/no-cycles" }] })
        .success
    ).toBe(false);
  });

  it("hashes normalised rules independently of analysis, formatting and order of sets", () => {
    function hash(text: string) {
      return computeRulesHash(archmindConfigSchema.parse(JSON.parse(text)).rules);
    }

    const compact = JSON.stringify({ rules: { definitions: [threshold, forbidden] } });
    const reformatted = JSON.stringify(
      {
        analysis: { exclude: ["fixtures/**"] },
        rules: {
          definitions: [
            { ...forbidden, from: [{ path: "./apps/web/" }], scope: { includeTypeOnly: true } },
            threshold
          ]
        }
      },
      null,
      2
    );
    expect(hash(reformatted)).toBe(hash(compact));
    expect(hash("{}")).toBe(hash('{"rules":{}}'));
    expect(hash(compact)).not.toBe(hash("{}"));
    expect(hash(compact)).not.toBe(hash(compact.replace('"max":10', '"max":11')));

    const layerRule = { id: "layering", severity: "error", type: "layers", layers };
    expect(computeRulesHash(rulesConfigSchema.parse({ definitions: [layerRule] }))).not.toBe(
      computeRulesHash(
        rulesConfigSchema.parse({ definitions: [{ ...layerRule, layers: [...layers].reverse() }] })
      )
    );
  });
});
