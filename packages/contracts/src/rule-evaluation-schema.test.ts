import { describe, expect, it } from "vitest";

import { ruleEvaluationSchema } from "./rule-evaluation-schema.js";

const finding = {
  ruleId: "forbid-api",
  ruleVersion: "1",
  severity: "error",
  message: "apps/web depends on apps/api.",
  subject: {
    kind: "dependency",
    fromComponentId: "package:apps/web",
    toComponentId: "package:apps/api"
  },
  evidence: [
    {
      filePath: "apps/web/src/index.ts",
      line: 1,
      column: 1,
      specifier: "api",
      kind: "static",
      role: "source"
    }
  ],
  evidenceTotal: 24,
  fingerprint: "d".repeat(64)
};
const evaluation = {
  schemaVersion: "1",
  governanceEngineVersion: "0.1.0",
  contentHash: "a".repeat(64),
  analysisConfigHash: "b".repeat(64),
  rulesHash: "c".repeat(64),
  createdAt: "2026-11-21T15:00:00.000Z",
  findings: [finding],
  diagnostics: [
    {
      ruleId: "missing-target",
      code: "SELECTOR_NO_MATCH",
      field: "to.0",
      message: "No component matched the selector."
    }
  ]
};

describe("ruleEvaluationSchema", () => {
  it("parses a separate, versioned evaluation with findings and diagnostics", () => {
    expect(ruleEvaluationSchema.parse(evaluation)).toEqual(evaluation);
    expect(ruleEvaluationSchema.safeParse({ ...evaluation, schemaVersion: "2" }).success).toBe(
      false
    );
    expect(ruleEvaluationSchema.safeParse({ ...evaluation, contentHash: undefined }).success).toBe(
      false
    );
  });

  it("rejects oversized evidence and an inconsistent total count", () => {
    const evidence = Array.from({ length: 21 }, (_, index) => ({
      ...finding.evidence[0],
      line: index + 1
    }));
    expect(
      ruleEvaluationSchema.safeParse({ ...evaluation, findings: [{ ...finding, evidence }] })
        .success
    ).toBe(false);
    expect(
      ruleEvaluationSchema.safeParse({
        ...evaluation,
        findings: [{ ...finding, evidenceTotal: 0 }]
      }).success
    ).toBe(false);
  });
});
