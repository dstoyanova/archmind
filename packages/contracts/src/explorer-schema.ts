import { z } from "zod";

import {
  architectureComponentSchema,
  architectureFileSchema,
  countsByKindSchema,
  countsByRoleSchema,
  diagnosticSchema,
  externalDependencySchema,
  fileRoleSchema,
  importKindSchema,
  resolutionStatsSchema,
  snapshotSourceSchema
} from "./snapshot-schema.js";

const id = z.string().min(1);
const count = z.number().int().nonnegative();
const cursor = z.string().min(1).describe("Opaque continuation token for the same query.");

export const workspaceParamsSchema = z.object({ workspaceId: id });
export const snapshotParamsSchema = workspaceParamsSchema.extend({ id });
export const componentParamsSchema = snapshotParamsSchema.extend({ componentId: id });

function parseInteger(input: unknown): unknown {
  return typeof input === "string" && /^\d+$/.test(input) ? Number(input) : input;
}

function repeatedQueryParameter(input: unknown): unknown {
  return typeof input === "string" ? [input] : input;
}

function parseBoolean(input: unknown): unknown {
  if (input === "true" || input === "false") {
    return input === "true";
  }
  return input;
}

export const pageQuerySchema = z
  .object({
    cursor: cursor.optional(),
    limit: z.preprocess(parseInteger, z.number().int().min(1).max(100)).default(50)
  })
  .strict();

export const projectionQuerySchema = z
  .object({
    depth: z.preprocess(parseInteger, count.max(Number.MAX_SAFE_INTEGER)).default(1),
    expand: z
      .preprocess(repeatedQueryParameter, z.array(id))
      .default([])
      .describe("Component IDs to expand. Repeat this parameter for multiple IDs."),
    roles: z
      .preprocess(repeatedQueryParameter, z.array(fileRoleSchema).nonempty())
      .default(["source"])
      .describe("Import source roles. Repeat this parameter for multiple roles."),
    includeTypeOnly: z.preprocess(parseBoolean, z.boolean()).default(true)
  })
  .strict();

export const graphQueryParametersSchema = projectionQuerySchema.extend({
  level: z.enum(["component", "file"]).default("component"),
  componentId: id.optional().describe("Required for file level; omit for component level.")
});

export const graphQuerySchema = graphQueryParametersSchema.superRefine((query, context) => {
  if ((query.level === "file") !== (query.componentId !== undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["componentId"],
      message: "Provide componentId exactly when level is file."
    });
  }
});

export const dependencyEvidenceQuerySchema = projectionQuerySchema.merge(pageQuerySchema).extend({
  from: id.describe("Visible source component ID."),
  to: id.describe("Visible target component ID.")
});

function pageOf<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: cursor.nullable().describe("Null on the last page.")
  });
}

const snapshotIdentitySchema = z.object({
  id: id.describe("Opaque snapshot ID assigned by the reader, independent of contentHash."),
  label: z.string().min(1).describe("Display label supplied by the snapshot reader.")
});

const snapshotMetadataSchema = snapshotIdentitySchema.extend({
  contentHash: id,
  createdAt: z.string().datetime({ offset: true }),
  source: snapshotSourceSchema
});

export const snapshotListSchema = pageOf(
  z.discriminatedUnion("status", [
    snapshotMetadataSchema.extend({ status: z.literal("ready") }),
    snapshotIdentitySchema.extend({
      status: z.literal("invalid"),
      reason: z.string().min(1).describe("A safe explanation of why the snapshot could not load.")
    })
  ])
);

export const snapshotOverviewSchema = snapshotMetadataSchema.extend({
  schemaVersion: id,
  engineVersion: id,
  parserVersion: id,
  analysisConfigHash: id,
  resolutionStats: resolutionStatsSchema,
  componentCount: count,
  fileCount: count,
  diagnosticCount: count
});

export const explorerComponentSchema = architectureComponentSchema.extend({
  metrics: architectureComponentSchema.shape.metrics.describe(
    "Stored production-graph metrics at this component's own depth. Graph filters do not change them."
  )
});

export const projectedDependencySchema = z.object({
  fromComponentId: id,
  toComponentId: id,
  weight: count,
  countsByKind: countsByKindSchema,
  countsByRole: countsByRoleSchema
});

const explorerExternalDependencySchema = externalDependencySchema.describe(
  "External package imports aggregated by source role. Snapshot external totals do not track import kinds."
);

export const componentGraphSchema = z.object({
  level: z.literal("component"),
  components: z.array(explorerComponentSchema),
  dependencies: z.array(projectedDependencySchema),
  externalDependencies: z.array(explorerExternalDependencySchema),
  cycles: z.array(z.object({ memberIds: z.array(id).min(1), typeOnly: z.boolean() }))
});

const fileImportLocationSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  specifier: z.string().min(1),
  kind: importKindSchema
});

export const fileGraphSchema = z.object({
  level: z.literal("file"),
  files: z.array(architectureFileSchema),
  components: z.array(explorerComponentSchema),
  imports: z.array(
    fileImportLocationSchema.extend({
      fromFileId: id,
      target: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("file"), fileId: id }),
        z.object({ kind: z.literal("component"), componentId: id })
      ])
    })
  )
});

export const graphResponseSchema = z.discriminatedUnion("level", [
  componentGraphSchema,
  fileGraphSchema
]);

export const componentDetailSchema = z.object({
  component: explorerComponentSchema,
  children: z.array(explorerComponentSchema),
  inboundDependencies: z.array(projectedDependencySchema),
  outboundDependencies: z.array(projectedDependencySchema),
  externalDependencies: z.array(explorerExternalDependencySchema)
});

export const dependencyEvidenceSchema = fileImportLocationSchema.extend({
  filePath: z.string().min(1),
  role: fileRoleSchema
});

export const dependencyEvidencePageSchema = pageOf(dependencyEvidenceSchema);
export const componentFilesPageSchema = pageOf(architectureFileSchema);
export const diagnosticsPageSchema = pageOf(diagnosticSchema);

export const explorerErrorSchema = z.object({
  error: z.object({
    code: id,
    message: z.string().min(1),
    details: z.record(z.unknown()).optional()
  })
});

export type ProjectionQuery = z.output<typeof projectionQuerySchema>;
export type GraphQuery = z.output<typeof graphQuerySchema>;
export type DependencyEvidenceQuery = z.output<typeof dependencyEvidenceQuerySchema>;
export type PageQuery = z.output<typeof pageQuerySchema>;
export type SnapshotList = z.infer<typeof snapshotListSchema>;
export type SnapshotListItem = SnapshotList["items"][number];
export type SnapshotOverview = z.infer<typeof snapshotOverviewSchema>;
export type ComponentGraph = z.infer<typeof componentGraphSchema>;
export type FileGraph = z.infer<typeof fileGraphSchema>;
export type GraphResponse = z.infer<typeof graphResponseSchema>;
export type ComponentDetail = z.infer<typeof componentDetailSchema>;
export type DependencyEvidence = z.infer<typeof dependencyEvidenceSchema>;
export type DependencyEvidencePage = z.infer<typeof dependencyEvidencePageSchema>;
export type ComponentFilesPage = z.infer<typeof componentFilesPageSchema>;
export type DiagnosticsPage = z.infer<typeof diagnosticsPageSchema>;
export type ExplorerError = z.infer<typeof explorerErrorSchema>;
