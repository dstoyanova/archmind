interface ComparableEvaluation<Finding> {
  readonly rulesHash: string;
  readonly analysisConfigHash: string;
  readonly findings: readonly Finding[];
}

export interface EvaluationComparison<Finding> {
  readonly newFindings: readonly Finding[];
  readonly existingFindings: readonly Finding[];
  readonly resolvedFindings: readonly Finding[];
  readonly rulesChanged: boolean;
  readonly hierarchyChanged: boolean;
}

export function compareEvaluations<Finding extends { readonly fingerprint: string }>(
  base: ComparableEvaluation<Finding>,
  head: ComparableEvaluation<Finding>
): EvaluationComparison<Finding> {
  const baseFingerprints = new Set(base.findings.map((finding) => finding.fingerprint));
  const headFingerprints = new Set(head.findings.map((finding) => finding.fingerprint));
  return {
    newFindings: head.findings.filter((finding) => !baseFingerprints.has(finding.fingerprint)),
    existingFindings: head.findings.filter((finding) => baseFingerprints.has(finding.fingerprint)),
    resolvedFindings: base.findings.filter((finding) => !headFingerprints.has(finding.fingerprint)),
    rulesChanged: base.rulesHash !== head.rulesHash,
    hierarchyChanged: base.analysisConfigHash !== head.analysisConfigHash
  };
}
