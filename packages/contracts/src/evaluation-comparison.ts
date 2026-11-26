import { compareEvaluations, type EvaluationComparison } from "@archmind/domain";

import type { FindingSubject, RuleEvaluation, RuleFinding } from "./rule-evaluation-schema.js";

export interface RuleEvaluationComparison extends EvaluationComparison<RuleFinding> {
  /** Both evaluations have findings, but they have no component in common. */
  readonly unrelatedBaseline: boolean;
}

export function findingComponentIds(subject: FindingSubject): string[] {
  switch (subject.kind) {
    case "components":
      return subject.componentIds;
    case "dependency":
      return [subject.fromComponentId, subject.toComponentId];
    case "external-package":
      return [subject.componentId];
  }
}

export function compareRuleEvaluations(
  base: RuleEvaluation,
  head: RuleEvaluation
): RuleEvaluationComparison {
  const baseComponents = new Set(
    base.findings.flatMap(({ subject }) => findingComponentIds(subject))
  );
  const unrelatedBaseline =
    base.findings.length > 0 &&
    head.findings.length > 0 &&
    !head.findings.some(({ subject }) =>
      findingComponentIds(subject).some((id) => baseComponents.has(id))
    );
  return { ...compareEvaluations(base, head), unrelatedBaseline };
}
