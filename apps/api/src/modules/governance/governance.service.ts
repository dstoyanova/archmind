import {
  compareRuleEvaluations,
  findingComponentIds,
  MAX_FINDING_HIGHLIGHTS,
  type EvaluationDetail,
  type EvaluationHealth,
  type EvaluationList,
  type FindingDetail,
  type FindingHighlights,
  type FindingSummary,
  type FindingsPage,
  type FindingsQuery,
  type PageQuery,
  type RuleEvaluationComparison,
  type RuleFinding,
  type SnapshotIdentity
} from "@archmind/contracts";
import { compareStrings } from "@archmind/domain";
import { HttpException, Inject, Injectable } from "@nestjs/common";

import { paginate } from "../architecture-model/explorer-pagination.js";
import { SNAPSHOT_READER, type SnapshotReader } from "../architecture-model/snapshot-reader.js";
import { findIntegrityIssue } from "./evaluation-integrity.js";
import {
  EVALUATION_READER,
  type EvaluationIdentity,
  type EvaluationMetadata,
  type EvaluationReader
} from "./file-evaluation-reader.js";

const INTEGRITY_CACHE_ENTRIES = 256;

function fail(status: number, code: string, message: string): never {
  throw new HttpException({ error: { code, message } }, status);
}

function metadata(identity: EvaluationIdentity, evaluation: EvaluationMetadata) {
  return { ...identity, ...evaluation };
}

function comparisonFlags({
  rulesChanged,
  hierarchyChanged,
  engineChanged,
  unrelatedBaseline
}: RuleEvaluationComparison) {
  return { rulesChanged, hierarchyChanged, engineChanged, unrelatedBaseline };
}

function summary(evaluationId: string, finding: RuleFinding): FindingSummary {
  const {
    fingerprint,
    ruleId,
    ruleVersion,
    severity,
    message,
    subject,
    evidenceTotal,
    graphScope
  } = finding;
  return {
    id: fingerprint,
    evaluationId,
    fingerprint,
    ruleId,
    ruleVersion,
    severity,
    message,
    subject,
    graphScope,
    evidenceTotal
  };
}

@Injectable()
export class GovernanceService {
  private readonly integrity = new Map<string, string | undefined>();

  constructor(
    @Inject(SNAPSHOT_READER) private readonly snapshots: SnapshotReader,
    @Inject(EVALUATION_READER) private readonly evaluations: EvaluationReader
  ) {}

  async list(id: string, query: PageQuery): Promise<EvaluationList> {
    const snapshotIdentities = await this.snapshots.list();
    const identity = snapshotIdentities.find((item) => item.id === id);
    if (!identity) fail(404, "SNAPSHOT_NOT_FOUND", "Snapshot not found.");
    const snapshot = await this.snapshots.summarize(identity);
    if (snapshot.status === "invalid") fail(422, "INVALID_SNAPSHOT", snapshot.reason);
    const snapshots = await this.snapshotIndex(snapshotIdentities);
    const items: EvaluationList["items"] = [];
    const issues: EvaluationList["issues"] = [];
    for (const candidate of await this.evaluations.list()) {
      const summary = await this.evaluations.summarize(candidate);
      if (summary.status === "invalid") {
        issues.push({ ...candidate, reason: summary.reason });
        continue;
      }
      const snapshotIdentity = snapshots.get(summary.metadata.contentHash);
      if (!snapshotIdentity) {
        issues.push({
          ...candidate,
          reason: "No readable snapshot matches the evaluation content hash."
        });
      } else if (summary.metadata.contentHash === snapshot.contentHash) {
        const reason = await this.integrityIssue(candidate, summary.revision, snapshotIdentity);
        if (reason === undefined) items.push(metadata(candidate, summary.metadata));
        else issues.push({ ...candidate, reason });
      }
    }
    return {
      ...paginate(items, query, { kind: "evaluations", id, hash: snapshot.contentHash }),
      issues
    };
  }

  async detail(id: string): Promise<EvaluationDetail> {
    const { identity, evaluation } = await this.get(id);
    return {
      ...metadata(identity, { ...evaluation, findingCount: evaluation.findings.length }),
      diagnostics: evaluation.diagnostics
    };
  }

  async findings(id: string, query: FindingsQuery): Promise<FindingsPage> {
    const { baseline, severity, status, ruleId } = query;
    const { head, base, comparison, findings } = await this.resolveFindings(id, query);
    const page = paginate(findings, query, {
      kind: "findings",
      id,
      revision: head.revision,
      baseline,
      baselineRevision: base?.revision,
      severity,
      status,
      ruleId
    });
    return comparison ? { ...page, comparison: comparisonFlags(comparison) } : page;
  }

  async highlights(id: string, query: Omit<FindingsQuery, "cursor" | "limit">) {
    const { findings } = await this.resolveFindings(id, query);
    const items = findings
      .filter((item) => item.status !== "resolved")
      .slice(0, MAX_FINDING_HIGHLIGHTS)
      .map(({ subject, severity }) => ({
        componentIds: [...new Set(findingComponentIds(subject))],
        severity
      }));
    return { total: findings.length, items } satisfies FindingHighlights;
  }

  async finding(id: string, findingId: string, query: PageQuery): Promise<FindingDetail> {
    const { evaluation, revision } = await this.get(id);
    const finding = evaluation.findings.find((item) => item.fingerprint === findingId);
    if (!finding) fail(404, "FINDING_NOT_FOUND", "Finding not found.");
    return {
      ...summary(id, finding),
      evidence: paginate(finding.evidence, query, {
        kind: "finding-evidence",
        id,
        findingId,
        revision
      })
    };
  }

  async health(id: string, baseline?: string): Promise<EvaluationHealth> {
    const catalog = await this.evaluations.list();
    const head = await this.get(id, catalog);
    const base = baseline === undefined ? undefined : await this.get(baseline, catalog);
    const loaded = await this.snapshots.load(head.snapshotIdentity);
    if (loaded.status === "invalid") fail(422, "INVALID_SNAPSHOT", loaded.reason);
    const { snapshot } = loaded.data;
    if (snapshot.contentHash !== head.evaluation.contentHash) {
      fail(422, "INVALID_EVALUATION", "Snapshot has changed. Refresh the evaluation listing.");
    }
    const bySeverity = { error: 0, warning: 0 };
    const byRule = new Map<string, number>();
    const byComponent = new Map<string, number>();
    const byCode = new Map<string, number>();
    const increment = (map: Map<string, number>, key: string) =>
      map.set(key, (map.get(key) ?? 0) + 1);
    for (const item of head.evaluation.findings) {
      bySeverity[item.severity]++;
      increment(byRule, item.ruleId);
      for (const component of new Set(findingComponentIds(item.subject)))
        increment(byComponent, component);
    }
    for (const diagnostic of snapshot.diagnostics) increment(byCode, diagnostic.code);
    const comparison = base && compareRuleEvaluations(base.evaluation, head.evaluation);
    return {
      bySeverity,
      byRule: [...byRule]
        .sort(([a], [b]) => compareStrings(a, b))
        .map(([ruleId, count]) => ({ ruleId, count })),
      topComponents: snapshot.components
        .filter(({ id }) => byComponent.has(id))
        .map(({ id, paths }) => ({ componentId: id, paths, count: byComponent.get(id) ?? 0 }))
        .sort((a, b) => b.count - a.count || compareStrings(a.componentId, b.componentId))
        .slice(0, 10),
      coverage: {
        unresolvedRate: snapshot.resolutionStats.unresolvedRate,
        diagnosticTotal: snapshot.diagnostics.length,
        diagnosticsByCode: Object.fromEntries([...byCode].sort(([a], [b]) => compareStrings(a, b)))
      },
      ...(comparison && {
        comparison: {
          ...comparisonFlags(comparison),
          newCount: comparison.newFindings.length,
          resolvedCount: comparison.resolvedFindings.length
        }
      })
    };
  }

  private async resolveFindings(
    id: string,
    { baseline, severity, status, ruleId }: Omit<FindingsQuery, "cursor" | "limit">
  ) {
    if (status !== undefined && baseline === undefined) {
      fail(400, "INVALID_REQUEST", "The status filter requires a baseline evaluation.");
    }
    const catalog = await this.evaluations.list();
    const head = await this.get(id, catalog);
    const base = baseline === undefined ? undefined : await this.get(baseline, catalog);
    const comparison = base && compareRuleEvaluations(base.evaluation, head.evaluation);
    let findings: FindingSummary[];
    if (base && comparison) {
      const existing = new Set(comparison.existingFindings.map((item) => item.fingerprint));
      findings =
        status === "resolved"
          ? comparison.resolvedFindings.map((item) => ({
              ...summary(base.identity.id, item),
              status: "resolved"
            }))
          : head.evaluation.findings.map((item) => ({
              ...summary(id, item),
              status: existing.has(item.fingerprint) ? "existing" : "new"
            }));
    } else {
      findings = head.evaluation.findings.map((item) => summary(id, item));
    }
    return {
      head,
      base,
      comparison,
      findings: findings.filter(
        (item) =>
          (severity === undefined || item.severity === severity) &&
          (ruleId === undefined || item.ruleId === ruleId) &&
          (status === undefined || item.status === status)
      )
    };
  }

  private async get(id: string, catalog?: readonly EvaluationIdentity[]) {
    const identity = (catalog ?? (await this.evaluations.list())).find((item) => item.id === id);
    if (!identity) fail(404, "EVALUATION_NOT_FOUND", "Evaluation not found.");
    const loaded = await this.evaluations.load(identity);
    if (loaded.status === "invalid") fail(422, "INVALID_EVALUATION", loaded.reason);
    const snapshots = await this.snapshotIndex(await this.snapshots.list());
    const snapshotIdentity = snapshots.get(loaded.evaluation.contentHash);
    if (!snapshotIdentity)
      fail(422, "INVALID_EVALUATION", "No readable snapshot matches the evaluation content hash.");
    const reason = await this.integrityIssue(identity, loaded.revision, snapshotIdentity);
    if (reason !== undefined) fail(422, "INVALID_EVALUATION", reason);
    return { identity, snapshotIdentity, ...loaded };
  }

  /** Checks an evaluation against its snapshot once per file revision and snapshot content. */
  private async integrityIssue(
    identity: EvaluationIdentity,
    revision: string,
    snapshotIdentity: SnapshotIdentity
  ): Promise<string | undefined> {
    const evaluation = await this.evaluations.load(identity);
    if (evaluation.status === "invalid") return evaluation.reason;
    const key = `${identity.id}:${revision}:${evaluation.evaluation.contentHash}`;
    if (this.integrity.has(key)) return this.integrity.get(key);
    const snapshot = await this.snapshots.load(snapshotIdentity);
    const reason =
      snapshot.status === "invalid"
        ? snapshot.reason
        : findIntegrityIssue(evaluation.evaluation, snapshot.data);
    this.integrity.set(key, reason);
    const oldest = this.integrity.keys().next().value;
    if (this.integrity.size > INTEGRITY_CACHE_ENTRIES && oldest !== undefined) {
      this.integrity.delete(oldest);
    }
    return reason;
  }

  private async snapshotIndex(identities: readonly SnapshotIdentity[]) {
    const snapshots = new Map<string, SnapshotIdentity>();
    for (const identity of identities) {
      const snapshot = await this.snapshots.summarize(identity);
      if (snapshot.status === "ready" && !snapshots.has(snapshot.contentHash))
        snapshots.set(snapshot.contentHash, identity);
    }
    return snapshots;
  }
}
