import { FILE_ROLES } from "@archmind/domain";
import { z } from "zod";

const rolePatternSchema = z.array(z.string().min(1));
const fileRoleSchema = z.enum(FILE_ROLES);

export const configuredComponentSchema = z.object({
  name: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  parent: z.string().min(1).optional()
});

export const analysisConfigSchema = z.object({
  components: z.array(configuredComponentSchema).default([]),
  componentRoots: z.record(z.string().min(1), z.string().min(1)).default({}),
  fileRoles: z.record(fileRoleSchema, rolePatternSchema).default({})
});

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
