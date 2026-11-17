import { z } from "zod";

const rolePatternSchema = z.array(z.string().min(1));

export const configuredComponentSchema = z
  .object({
    name: z.string().min(1),
    paths: z.array(z.string().min(1)).min(1),
    parent: z.string().min(1).optional()
  })
  .strict();

/** `source` is the fallback role and cannot be overridden with patterns. */
const fileRolesSchema = z
  .object({
    test: rolePatternSchema.optional(),
    story: rolePatternSchema.optional(),
    script: rolePatternSchema.optional(),
    config: rolePatternSchema.optional()
  })
  .strict();

/** Makes `./apps/api`, `apps/api/` and `apps\api` equivalent keys. */
function normalizeConfigPath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^(?:\.\/)+/u, "").replace(/\/+$/u, "");
  return normalized === "" ? "." : normalized;
}

const componentRootsSchema = z
  .record(z.string().min(1), z.string().min(1))
  .transform((roots, ctx) => {
    const normalizedRoots: Record<string, string> = {};
    for (const [packageDirectory, componentRoot] of Object.entries(roots)) {
      const key = normalizeConfigPath(packageDirectory);
      if (key in normalizedRoots) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate component root for package directory "${key}".`
        });
        continue;
      }

      normalizedRoots[key] = normalizeConfigPath(componentRoot);
    }

    return normalizedRoots;
  });

const componentsSchema = z.array(configuredComponentSchema).superRefine((components, ctx) => {
  const seenNames = new Set<string>();
  for (const [index, component] of components.entries()) {
    if (seenNames.has(component.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "name"],
        message: `Duplicate component name "${component.name}".`
      });
    }

    seenNames.add(component.name);
  }
});

export const analysisConfigSchema = z
  .object({
    components: componentsSchema.default([]),
    componentRoots: componentRootsSchema.default({}),
    fileRoles: fileRolesSchema.default({})
  })
  .strict();

export const archmindConfigSchema = z
  .object({
    analysis: analysisConfigSchema.default({
      components: [],
      componentRoots: {},
      fileRoles: {}
    }),
    rules: z.unknown().optional()
  })
  .passthrough();

export type ConfiguredComponent = z.infer<typeof configuredComponentSchema>;
export type AnalysisConfig = z.infer<typeof analysisConfigSchema>;
export type ArchmindConfig = z.infer<typeof archmindConfigSchema>;
