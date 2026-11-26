import { describe, expect, it } from "vitest";

import { compareEvaluations } from "./compare-evaluations.js";

describe("compareEvaluations", () => {
  it("uses fingerprints for status, returns current existing findings, and flags config changes independently", () => {
    const resolved = { fingerprint: "old", message: "Resolved" };
    const existing = { fingerprint: "same", message: "New location" };
    const added = { fingerprint: "new", message: "Added" };
    const base = {
      governanceEngineVersion: "1",
      rulesHash: "old-rules",
      analysisConfigHash: "same-analysis",
      findings: [resolved, { ...existing, message: "Old location" }]
    };
    const head = {
      governanceEngineVersion: "1",
      rulesHash: "new-rules",
      analysisConfigHash: "same-analysis",
      findings: [existing, added]
    };
    expect(compareEvaluations(base, head)).toEqual({
      newFindings: [added],
      existingFindings: [existing],
      resolvedFindings: [resolved],
      rulesChanged: true,
      hierarchyChanged: false,
      engineChanged: false
    });
    expect(compareEvaluations(head, { ...head, analysisConfigHash: "new-analysis" })).toMatchObject(
      {
        rulesChanged: false,
        hierarchyChanged: true,
        engineChanged: false
      }
    );
    expect(compareEvaluations(head, { ...head, governanceEngineVersion: "2" })).toMatchObject({
      newFindings: [],
      rulesChanged: false,
      hierarchyChanged: false,
      engineChanged: true
    });
  });
});
