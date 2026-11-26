import { findingComponentIds, type RuleEvaluation } from "@archmind/contracts";

import type { LoadedSnapshot } from "../architecture-model/snapshot-reader.js";

/** Returns why an evaluation cannot be rendered against its snapshot, if it cannot. */
export function findIntegrityIssue(
  evaluation: RuleEvaluation,
  { snapshot }: LoadedSnapshot
): string | undefined {
  if (evaluation.analysisConfigHash !== snapshot.analysisConfigHash) {
    return "Evaluation analysis configuration hash does not match its snapshot.";
  }
  const components = new Set(snapshot.components.map(({ id }) => id));
  const paths = new Set(snapshot.files.map(({ path }) => path));
  for (const { ruleId, subject, evidence } of evaluation.findings) {
    if (findingComponentIds(subject).some((id) => !components.has(id))) {
      return `A finding of rule "${ruleId}" refers to a component that is not in its snapshot.`;
    }
    if (evidence.some(({ filePath }) => !paths.has(filePath))) {
      return `A finding of rule "${ruleId}" cites a file that is not in its snapshot.`;
    }
  }
  return undefined;
}
