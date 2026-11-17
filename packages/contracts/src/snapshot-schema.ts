import {
  COMPONENT_KINDS,
  DIAGNOSTIC_SEVERITIES,
  FILE_ROLES,
  IMPORT_KINDS,
  IMPORT_RESOLUTIONS,
  PARSE_STATUSES,
  SOURCE_KINDS,
  SYMBOL_KINDS,
  validateSnapshotInvariants
} from "@archmind/domain";
import { z } from "zod";

const nonNegativeInt = z.number().int().nonnegative();
const nonNegativeNumber = z.number().nonnegative();
const positiveInt = z.number().int().positive();

const fileRoleSchema = z.enum(FILE_ROLES);
const importKindSchema = z.enum(IMPORT_KINDS);
const importResolutionSchema = z.enum(IMPORT_RESOLUTIONS);

const countsByKindSchema = z.record(importKindSchema, nonNegativeInt);
const countsByRoleSchema = z.record(fileRoleSchema, nonNegativeInt);
const countsByResolutionSchema = z.record(importResolutionSchema, nonNegativeInt);

const componentMetricsSchema = z.object({
  fileCount: nonNegativeInt,
  loc: nonNegativeInt,
  fanIn: nonNegativeInt,
  fanOut: nonNegativeInt,
  instability: nonNegativeNumber
});

const architectureComponentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().min(1).optional(),
  depth: nonNegativeInt,
  kind: z.enum(COMPONENT_KINDS),
  paths: z.array(z.string().min(1)),
  metrics: componentMetricsSchema
});

const architectureFileSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  componentId: z.string().min(1),
  role: fileRoleSchema,
  language: z.string().min(1),
  loc: nonNegativeInt,
  parseStatus: z.enum(PARSE_STATUSES)
});

const architectureSymbolSchema = z.object({
  id: z.string().min(1),
  fileId: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(SYMBOL_KINDS),
  line: positiveInt,
  column: positiveInt
});

const fileImportSchema = z.object({
  id: z.string().min(1),
  fromFileId: z.string().min(1),
  specifier: z.string().min(1),
  kind: importKindSchema,
  resolution: importResolutionSchema,
  toFileId: z.string().min(1).optional(),
  toComponentId: z.string().min(1).optional(),
  externalPackage: z.string().min(1).optional(),
  line: positiveInt,
  column: positiveInt
});

const dependencySchema = z.object({
  id: z.string().min(1),
  fromComponentId: z.string().min(1),
  toComponentId: z.string().min(1),
  weight: nonNegativeInt,
  countsByKind: countsByKindSchema,
  countsByRole: countsByRoleSchema,
  evidenceImportIds: z.array(z.string().min(1))
});

const externalDependencySchema = z.object({
  componentId: z.string().min(1),
  packageName: z.string().min(1),
  weight: nonNegativeInt,
  countsByRole: countsByRoleSchema
});

const cycleLevelSchema = z.union([
  z.object({
    kind: z.literal("depth"),
    depth: nonNegativeInt
  }),
  z.object({
    kind: z.literal("file")
  })
]);

const cycleSchema = z.object({
  level: cycleLevelSchema,
  memberIds: z.array(z.string().min(1)).min(1),
  typeOnly: z.boolean()
});

const resolutionStatsSchema = z.object({
  countsByResolution: countsByResolutionSchema,
  unresolvedRate: z.number().min(0).max(1)
});

const diagnosticSchema = z.object({
  severity: z.enum(DIAGNOSTIC_SEVERITIES),
  code: z.string().min(1),
  message: z.string().min(1),
  filePath: z.string().min(1).optional(),
  line: positiveInt.optional()
});

const snapshotSourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  sourceHash: z.string().min(1),
  commitSha: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  commitTimestamp: z.string().min(1).optional(),
  workingTreeDirty: z.boolean().optional()
});

export const architectureSnapshotSchema = z
  .object({
    schemaVersion: z.string().min(1),
    engineVersion: z.string().min(1),
    parserVersion: z.string().min(1),
    analysisConfigHash: z.string().min(1),
    contentHash: z.string().min(1),
    source: snapshotSourceSchema,
    createdAt: z.string().datetime({ offset: true }),
    components: z.array(architectureComponentSchema),
    files: z.array(architectureFileSchema),
    symbols: z.array(architectureSymbolSchema),
    fileImports: z.array(fileImportSchema),
    dependencies: z.array(dependencySchema),
    externalDependencies: z.array(externalDependencySchema),
    cycles: z.array(cycleSchema),
    resolutionStats: resolutionStatsSchema,
    diagnostics: z.array(diagnosticSchema)
  })
  .superRefine((snapshot, ctx) => {
    const errors = validateSnapshotInvariants(snapshot);
    for (const error of errors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${error.code}: ${error.message}`
      });
    }
  });

export type ArchitectureSnapshotDocument = z.infer<typeof architectureSnapshotSchema>;
