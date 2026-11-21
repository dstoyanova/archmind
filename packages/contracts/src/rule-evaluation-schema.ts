import { z } from "zod";

import { dependencyEvidenceSchema } from "./explorer-schema.js";
import { ruleSeveritySchema } from "./rules-schema.js";

export const RULE_EVALUATION_SCHEMA_VERSION = "1";
export const FINDING_EVIDENCE_LIMIT = 20;

const id = z.string().min(1);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);

export const findingSubjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("components"), componentIds: z.array(id).min(1) }).strict(),
  z.object({ kind: z.literal("dependency"), fromComponentId: id, toComponentId: id }).strict(),
  z.object({ kind: z.literal("external-package"), componentId: id, packageName: id }).strict()
]);

export const ruleFindingSchema = z
  .object({
    ruleId: id,
    ruleVersion: id,
    severity: ruleSeveritySchema,
    message: id,
    subject: findingSubjectSchema,
    evidence: z.array(dependencyEvidenceSchema.strict()).max(FINDING_EVIDENCE_LIMIT),
    evidenceTotal: z.number().int().nonnegative(),
    fingerprint: sha256
  })
  .strict()
  .refine((finding) => finding.evidenceTotal >= finding.evidence.length, {
    path: ["evidenceTotal"],
    message: "Total evidence count must include all retained evidence."
  });

export const ruleDiagnosticSchema = z
  .object({
    ruleId: id,
    code: id,
    message: id,
    field: id.optional()
  })
  .strict();

export const ruleEvaluationSchema = z
  .object({
    schemaVersion: z.literal(RULE_EVALUATION_SCHEMA_VERSION),
    governanceEngineVersion: id,
    rulesHash: sha256,
    contentHash: sha256,
    analysisConfigHash: sha256,
    createdAt: z.string().datetime({ offset: true }),
    findings: z.array(ruleFindingSchema),
    diagnostics: z.array(ruleDiagnosticSchema)
  })
  .strict();

export type RuleEvaluation = z.output<typeof ruleEvaluationSchema>;
export type RuleFinding = z.output<typeof ruleFindingSchema>;
export type FindingSubject = z.output<typeof findingSubjectSchema>;
export type RuleDiagnostic = z.output<typeof ruleDiagnosticSchema>;
