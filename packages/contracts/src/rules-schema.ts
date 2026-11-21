import { canonicalJson, compareStrings } from "@archmind/domain";
import { z } from "zod";

import { architectureComponentSchema, fileRoleSchema } from "./snapshot-schema.js";

export const DEFAULT_RULE_IDS = ["archmind/no-cycles", "archmind/high-coupling"] as const;
export const ruleSeveritySchema = z.enum(["error", "warning"]);

const label = z.string().trim().min(1);
const pathSelectorSchema = label
  .transform((path) => path.replace(/^(?:\.\/)+/u, "") || ".")
  .refine(
    (path) =>
      !/^(?:\/|[a-z]:)|\\/iu.test(path) && !path.includes("\0") && !path.split("/").includes(".."),
    "Expected a repository-relative POSIX path or glob."
  )
  .transform((path) => path.replace(/\/+$/u, ""));

export const componentSelectorSchema = z.union([
  z.object({ path: pathSelectorSchema }).strict(),
  z.object({ name: z.string().min(1) }).strict()
]);

function sortedUnique<T>(items: T[], key: (item: T) => string): T[] {
  const byKey = new Map(items.map((item) => [key(item), item] as const));
  return [...byKey].sort(([a], [b]) => compareStrings(a, b)).map(([, item]) => item);
}

function sortedStrings<T extends string>(items: T[]): T[] {
  return [...new Set(items)].sort(compareStrings);
}

const selectors = z.array(componentSelectorSchema);
const selectorSet = selectors.transform((items) => sortedUnique(items, canonicalJson));
const nonEmptySelectorSet = selectors
  .min(1)
  .transform((items) => sortedUnique(items, canonicalJson));
const ruleScopeSchema = z
  .object({
    additionalFileRoles: z
      .array(fileRoleSchema.exclude(["source"]))
      .default([])
      .transform(sortedStrings),
    includeTypeOnly: z.boolean().default(true)
  })
  .strict();
const graphRule = {
  scope: ruleScopeSchema.default({})
};

const baseRule = {
  id: label.refine((id) => !id.startsWith("archmind/"), 'The prefix "archmind/" is reserved.'),
  severity: ruleSeveritySchema
};

const layerSchema = z.object({ name: label, components: nonEmptySelectorSet }).strict();
const packageName = label.regex(/^(?:@[\w.-]+\/)?[\w.-]+$/u, "Expected an exact package name.");

const ruleDefinitionSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...baseRule,
      ...graphRule,
      type: z.literal("layers"),
      layers: z.array(layerSchema).min(2)
    })
    .strict(),
  z
    .object({
      ...baseRule,
      ...graphRule,
      type: z.literal("forbidden-dependency"),
      from: nonEmptySelectorSet,
      to: nonEmptySelectorSet
    })
    .strict(),
  z
    .object({
      ...baseRule,
      ...graphRule,
      type: z.literal("no-cycles"),
      components: nonEmptySelectorSet.optional(),
      includeTypeOnlyCycles: z.boolean().default(false)
    })
    .strict(),
  z
    .object({
      ...baseRule,
      type: z.literal("threshold"),
      components: nonEmptySelectorSet,
      metric: architectureComponentSchema.shape.metrics.keyof(),
      max: z.number().finite().nonnegative()
    })
    .strict(),
  z
    .object({
      ...baseRule,
      ...graphRule,
      type: z.literal("restricted-package"),
      packages: z.array(packageName).min(1).transform(sortedStrings),
      allow: selectorSet
    })
    .strict()
]);

function ruleId(value: unknown): string | undefined {
  if (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string"
  ) {
    return value.id.trim() || undefined;
  }
  return undefined;
}

const checkedRuleSchema = z.unknown().transform((input, ctx) => {
  const parsed = ruleDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    const id = ruleId(input);
    const label = id === undefined ? "Rule" : `Rule ${JSON.stringify(id)}`;
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".") || "(definition)";
      ctx.addIssue({ ...issue, fatal: true, message: `${label}, ${field}: ${issue.message}` });
    }
    return z.NEVER;
  }

  const rule = parsed.data;
  if (rule.type === "layers") {
    const seen = new Set<string>();
    for (const [index, layer] of rule.layers.entries()) {
      if (seen.has(layer.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers", index, "name"],
          message: `Rule ${JSON.stringify(rule.id)}, layers.${index}.name: duplicate layer name.`
        });
      }
      seen.add(layer.name);
    }
  }
  return rule;
});

export const rulesConfigSchema = z
  .object({
    definitions: z
      .array(checkedRuleSchema)
      .default([])
      .superRefine((rules, ctx) => {
        const seen = new Set<string>();
        for (const [index, rule] of rules.entries()) {
          if (seen.has(rule.id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [index, "id"],
              message: `Rule ${JSON.stringify(rule.id)}, id: duplicate rule ID.`
            });
          }
          seen.add(rule.id);
        }
      })
      .transform((rules) => [...rules].sort((a, b) => compareStrings(a.id, b.id))),
    disableDefaults: z.array(z.enum(DEFAULT_RULE_IDS)).default([]).transform(sortedStrings)
  })
  .strict()
  .default({});

export type ComponentSelector = z.output<typeof componentSelectorSchema>;
export type RuleDefinition = z.output<typeof ruleDefinitionSchema>;
export type RulesConfig = z.output<typeof rulesConfigSchema>;

export function enabledDefaultRuleIds(
  rules: RulesConfig
): ReadonlyArray<(typeof DEFAULT_RULE_IDS)[number]> {
  return DEFAULT_RULE_IDS.filter((id) => !rules.disableDefaults.includes(id));
}
