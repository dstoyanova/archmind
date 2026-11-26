import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  analyzeRepository,
  computeAnalysisConfigHash,
  CONFIG_FILENAME,
  readArchmindConfig
} from "@archmind/analysis-pipeline";
import { DEFAULT_SNAPSHOT_SCHEMA_VERSION, verifyContentHash } from "@archmind/architecture-engine";
import {
  architectureSnapshotSchema,
  archmindConfigSchema,
  compareRuleEvaluations,
  ruleEvaluationSchema,
  ruleSeveritySchema,
  type ArchitectureSnapshotDocument,
  type RuleEvaluation,
  type RuleEvaluationComparison,
  type RuleFinding
} from "@archmind/contracts";
import { compareStrings } from "@archmind/domain";
import { evaluate, GOVERNANCE_ENGINE_VERSION } from "@archmind/governance-engine";

import { writeJsonAtomically } from "./analyze.js";
import type { CliIo } from "./main.js";

const SUMMARY_FINDING_LIMIT = 20;

export const CHECK_USAGE =
  "  archmind check [<path>] [--snapshot <snapshot.json>] [--out <evaluation.json>] [--format summary|evaluation] [--fail-on error|warning] [--baseline <evaluation.json> [--new-only]]";

export async function runCheck(args: string[], io: CliIo): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        snapshot: { type: "string" },
        out: { type: "string" },
        format: { type: "string", default: "evaluation" },
        "fail-on": { type: "string", default: "error" },
        baseline: { type: "string" },
        "new-only": { type: "boolean", default: false },
        help: { type: "boolean", short: "h" }
      }
    });
    if (values.help) {
      io.stdout(CHECK_USAGE);
      return 0;
    }
    if (positionals.length > 1 || (positionals.length === 0 && values.snapshot === undefined)) {
      throw new Error("Provide a repository path or --snapshot.");
    }
    if (values["new-only"] && values.baseline === undefined) {
      throw new Error("--new-only requires --baseline.");
    }
    if (values.format !== "evaluation" && values.format !== "summary") {
      throw new Error('Invalid --format. Expected "evaluation" or "summary".');
    }
    const severity = ruleSeveritySchema.safeParse(values["fail-on"]);
    if (!severity.success) {
      throw new Error('Invalid --fail-on. Expected "error" or "warning".');
    }
    if (
      [...positionals, values.snapshot, values.out, values.baseline].some((value) => value === "")
    ) {
      throw new Error("Paths must not be empty.");
    }

    const repositoryRoot = await realpath(path.resolve(positionals[0] ?? "."));
    const snapshotPath = path.resolve(values.snapshot ?? "archmind.snapshot.json");
    const outputPath = path.resolve(values.out ?? `${snapshotPath}.evaluation.json`);
    const baselinePath = values.baseline === undefined ? undefined : path.resolve(values.baseline);
    const configPath = path.join(repositoryRoot, CONFIG_FILENAME);
    if (outputPath === snapshotPath || outputPath === baselinePath || outputPath === configPath) {
      throw new Error("--out must not overwrite the snapshot, baseline, or configuration.");
    }
    if (values.snapshot === undefined && snapshotPath === baselinePath) {
      throw new Error("The generated snapshot must not overwrite the baseline.");
    }

    const config = archmindConfigSchema.safeParse(await readArchmindConfig(repositoryRoot));
    if (!config.success) {
      const issues = config.error.issues.map(
        ({ path, message }) => `- ${path.join(".") || "(root)"}: ${message}`
      );
      throw new Error(`Invalid "${configPath}":\n${issues.join("\n")}`);
    }
    const baseline = baselinePath === undefined ? undefined : await readBaseline(baselinePath);
    let snapshot: ArchitectureSnapshotDocument;
    if (values.snapshot !== undefined) {
      snapshot = await readSnapshot(snapshotPath);
      if (snapshot.analysisConfigHash !== computeAnalysisConfigHash(config.data.analysis)) {
        io.stderr(
          "Warning: Current analysis configuration differs from the snapshot (analysisConfigHash). Re-analyze to apply the changes."
        );
      }
    } else {
      const result = await analyzeRepository({
        repositoryRoot,
        analysisConfig: config.data.analysis
      });
      for (const warning of result.warnings) {
        io.stderr(`Warning: ${warning}`);
      }
      snapshot = result.snapshot;
      await writeJsonAtomically(snapshotPath, snapshot);
    }

    const evaluation = evaluate(snapshot, config.data.rules, GOVERNANCE_ENGINE_VERSION);
    const comparison =
      baseline === undefined ? undefined : compareRuleEvaluations(baseline, evaluation);
    await writeJsonAtomically(outputPath, evaluation);
    const counted = values["new-only"] && comparison ? comparison.newFindings : evaluation.findings;
    const failing = counted.filter(
      (finding) => severity.data === "warning" || finding.severity === "error"
    );
    if (values.format === "summary") {
      io.stdout(
        formatSummary(snapshot, evaluation, comparison, outputPath, values["new-only"], failing)
      );
    }
    for (const diagnostic of evaluation.diagnostics) {
      io.stderr(
        `Rule ${diagnostic.ruleId}${diagnostic.field ? ` (${diagnostic.field})` : ""}: ${diagnostic.message}`
      );
    }
    if (comparison?.unrelatedBaseline) {
      io.stderr(
        "Warning: The baseline and this evaluation share no component. Check that the baseline belongs to this project."
      );
    }
    if (evaluation.diagnostics.length > 0) {
      return 2;
    }
    if (failing.length > 0) {
      if (values.format !== "summary") {
        io.stderr(
          `${failing.length} finding(s) at or above "${severity.data}" severity. Use --format summary to list them.`
        );
      }
      return 1;
    }
    return 0;
  } catch (error) {
    io.stderr(`Check failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  const text = await readFile(filePath, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in "${filePath}": ${String(error)}`, { cause: error });
  }
}

async function readSnapshot(filePath: string): Promise<ArchitectureSnapshotDocument> {
  const document = await readJson(filePath);
  const parsed = architectureSnapshotSchema.safeParse(document);
  if (!parsed.success) {
    throw new Error(`Invalid snapshot "${filePath}": ${parsed.error.issues[0]?.message}`);
  }
  if (parsed.data.schemaVersion !== DEFAULT_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported snapshot schema version "${parsed.data.schemaVersion}" in "${filePath}".`
    );
  }
  if (!verifyContentHash(parsed.data)) {
    throw new Error(`Snapshot contentHash does not match "${filePath}".`);
  }
  return parsed.data;
}

async function readBaseline(filePath: string): Promise<RuleEvaluation> {
  const parsed = ruleEvaluationSchema.safeParse(await readJson(filePath));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid baseline "${filePath}": ${issue?.path.join(".")}: ${issue?.message}`);
  }
  return parsed.data;
}

function formatSummary(
  snapshot: ArchitectureSnapshotDocument,
  evaluation: RuleEvaluation,
  comparison: RuleEvaluationComparison | undefined,
  outputPath: string,
  newOnly: boolean,
  failing: readonly RuleFinding[]
): string {
  const tally = (counts: Map<string, number>, key: string) =>
    counts.set(key, (counts.get(key) ?? 0) + 1);
  const byRule = new Map<string, number>();
  const byCode = new Map<string, number>();
  const errors = evaluation.findings.filter((finding) => finding.severity === "error").length;
  const warnings = evaluation.findings.length - errors;
  for (const finding of evaluation.findings) tally(byRule, finding.ruleId);
  for (const diagnostic of snapshot.diagnostics) tally(byCode, diagnostic.code);
  const formatCounts = (counts: Map<string, number>) =>
    [...counts]
      .sort(([a], [b]) => compareStrings(a, b))
      .map(([key, count]) => `  - ${key}: ${count}`);
  return [
    `Evaluation written to ${outputPath}.`,
    `- findings: ${errors} error(s), ${warnings} warning(s)`,
    "- findings by rule:",
    ...(byRule.size > 0 ? formatCounts(byRule) : ["  - none"]),
    ...formatFailing(failing, newOnly),
    ...(comparison
      ? [
          `- baseline: ${comparison.newFindings.length} new, ${comparison.existingFindings.length} existing, ${comparison.resolvedFindings.length} resolved`,
          `  - rules changed: ${comparison.rulesChanged ? "yes" : "no"}; hierarchy changed: ${comparison.hierarchyChanged ? "yes" : "no"}; engine changed: ${comparison.engineChanged ? "yes" : "no"}`,
          ...(newOnly ? ["  - only new findings count toward the exit code"] : [])
        ]
      : []),
    `- analysis coverage: ${(snapshot.resolutionStats.unresolvedRate * 100).toFixed(2)}% unresolved; ${snapshot.diagnostics.length} diagnostic(s)`,
    ...formatCounts(byCode),
    `- rule diagnostics: ${evaluation.diagnostics.length}`
  ].join("\n");
}

function formatFailing(failing: readonly RuleFinding[], newOnly: boolean): string[] {
  if (failing.length === 0) {
    return [];
  }
  const lines = failing.slice(0, SUMMARY_FINDING_LIMIT).map((finding) => {
    const first = finding.evidence[0];
    const location = first ? ` (${first.filePath}:${first.line}:${first.column})` : "";
    return `  - [${finding.severity}] ${finding.ruleId}: ${finding.message}${location}`;
  });
  const hidden = failing.length - lines.length;
  return [
    `- ${newOnly ? "new findings" : "findings"} that fail the check (${failing.length}):`,
    ...lines,
    ...(hidden > 0 ? [`  - … and ${hidden} more in the evaluation file`] : [])
  ];
}
