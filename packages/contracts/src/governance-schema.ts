import { z } from "zod";

import {
  dependencyEvidencePageSchema,
  pageOf,
  pageQuerySchema,
  snapshotParamsSchema
} from "./explorer-schema.js";
import { findingSubjectSchema, ruleEvaluationSchema } from "./rule-evaluation-schema.js";
import { ruleSeveritySchema } from "./rules-schema.js";

const id = z.string().min(1);
const count = z.number().int().nonnegative();
export const findingParamsSchema = snapshotParamsSchema.extend({ findingId: id });
export const baselineQuerySchema = z.object({ baseline: id.optional() }).strict();
export const findingStatusSchema = z.enum(["new", "existing", "resolved"]);
export const findingsQuerySchema = pageQuerySchema.extend({
  baseline: id.optional(),
  status: findingStatusSchema.optional().describe("Requires a baseline evaluation ID."),
  severity: ruleSeveritySchema.optional(),
  ruleId: id.optional()
});

const evaluationIdentitySchema = z.object({ id, label: id });
const evaluationMetadataSchema = evaluationIdentitySchema.merge(
  ruleEvaluationSchema.omit({ findings: true, diagnostics: true }).strip()
);
const evaluationIssueSchema = evaluationIdentitySchema.extend({ reason: id });
export const evaluationListSchema = pageOf(evaluationMetadataSchema).extend({
  issues: z.array(evaluationIssueSchema)
});
export const evaluationDetailSchema = evaluationMetadataSchema.extend({
  diagnostics: ruleEvaluationSchema.shape.diagnostics,
  findingCount: count
});

const comparisonSchema = z.object({ rulesChanged: z.boolean(), hierarchyChanged: z.boolean() });
export const findingSummarySchema = z.object({
  id,
  evaluationId: id.describe("Evaluation containing this finding, including resolved findings."),
  fingerprint: id,
  ruleId: id,
  ruleVersion: id,
  severity: ruleSeveritySchema,
  message: id,
  subject: findingSubjectSchema,
  evidenceTotal: count,
  status: findingStatusSchema.optional()
});
export const findingsPageSchema = pageOf(findingSummarySchema).extend({
  comparison: comparisonSchema.optional()
});
export const findingDetailSchema = findingSummarySchema.extend({
  evidence: dependencyEvidencePageSchema
});
export const evaluationHealthSchema = z.object({
  bySeverity: z.object({ error: count, warning: count }),
  byRule: z.array(z.object({ ruleId: id, count })),
  topComponents: z.array(z.object({ componentId: id, paths: z.array(id), count })),
  coverage: z.object({
    unresolvedRate: z.number().min(0).max(1),
    diagnosticTotal: count,
    diagnosticsByCode: z.record(count)
  }),
  comparison: comparisonSchema.extend({ newCount: count, resolvedCount: count }).optional()
});

export type EvaluationList = z.infer<typeof evaluationListSchema>;
export type EvaluationDetail = z.infer<typeof evaluationDetailSchema>;
export type FindingsQuery = z.output<typeof findingsQuerySchema>;
export type FindingsPage = z.infer<typeof findingsPageSchema>;
export type FindingSummary = z.infer<typeof findingSummarySchema>;
export type FindingDetail = z.infer<typeof findingDetailSchema>;
export type EvaluationHealth = z.infer<typeof evaluationHealthSchema>;
