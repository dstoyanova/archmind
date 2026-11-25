import type {
  EvaluationDetail,
  EvaluationHealth,
  EvaluationList,
  FindingDetail,
  FindingSubject,
  FindingSummary,
  FindingsPage,
  FindingsQuery,
  PageQuery,
  RuleEvaluation,
  RuleFinding,
  SnapshotIdentity
} from "@archmind/contracts";
import { compareEvaluations, compareStrings } from "@archmind/domain";
import { HttpException, Inject, Injectable } from "@nestjs/common";

import { paginate } from "../architecture-model/explorer-pagination.js";
import { SNAPSHOT_READER, type SnapshotReader } from "../architecture-model/snapshot-reader.js";
import {
  EVALUATION_READER,
  type EvaluationIdentity,
  type EvaluationReader
} from "./file-evaluation-reader.js";

function fail(status: number, code: string, message: string): never {
  throw new HttpException({ error: { code, message } }, status);
}

function metadata(identity: EvaluationIdentity, evaluation: RuleEvaluation) {
  const {
    schemaVersion,
    governanceEngineVersion,
    rulesHash,
    contentHash,
    analysisConfigHash,
    createdAt
  } = evaluation;
  return {
    ...identity,
    schemaVersion,
    governanceEngineVersion,
    rulesHash,
    contentHash,
    analysisConfigHash,
    createdAt
  };
}

function summary(evaluationId: string, finding: RuleFinding): FindingSummary {
  const { fingerprint, ruleId, ruleVersion, severity, message, subject, evidenceTotal } = finding;
  return {
    id: fingerprint,
    evaluationId,
    fingerprint,
    ruleId,
    ruleVersion,
    severity,
    message,
    subject,
    evidenceTotal
  };
}

function componentsOf(subject: FindingSubject): string[] {
  switch (subject.kind) {
    case "components":
      return subject.componentIds;
    case "dependency":
      return [subject.fromComponentId, subject.toComponentId];
    case "external-package":
      return [subject.componentId];
  }
}

@Injectable()
export class GovernanceService {
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
      const loaded = await this.evaluations.load(candidate);
      if (loaded.status === "invalid") {
        issues.push({ ...candidate, reason: loaded.reason });
      } else if (!snapshots.has(loaded.evaluation.contentHash)) {
        issues.push({
          ...candidate,
          reason: "No readable snapshot matches the evaluation content hash."
        });
      } else if (loaded.evaluation.contentHash === snapshot.contentHash) {
        items.push(metadata(candidate, loaded.evaluation));
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
      ...metadata(identity, evaluation),
      diagnostics: evaluation.diagnostics,
      findingCount: evaluation.findings.length
    };
  }

  async findings(id: string, query: FindingsQuery): Promise<FindingsPage> {
    const { baseline, severity, status, ruleId } = query;
    if (status !== undefined && baseline === undefined) {
      fail(400, "INVALID_REQUEST", "The status filter requires a baseline evaluation.");
    }
    const catalog = await this.evaluations.list();
    const head = await this.get(id, catalog);
    const base = baseline === undefined ? undefined : await this.get(baseline, catalog);
    const comparison = base && compareEvaluations(base.evaluation, head.evaluation);
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
    const filtered = findings.filter(
      (item) =>
        (severity === undefined || item.severity === severity) &&
        (ruleId === undefined || item.ruleId === ruleId) &&
        (status === undefined || item.status === status)
    );
    const page = paginate(filtered, query, {
      kind: "findings",
      id,
      revision: head.revision,
      baseline,
      baselineRevision: base?.revision,
      severity,
      status,
      ruleId
    });
    return comparison
      ? {
          ...page,
          comparison: {
            rulesChanged: comparison.rulesChanged,
            hierarchyChanged: comparison.hierarchyChanged
          }
        }
      : page;
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
      for (const component of new Set(componentsOf(item.subject)))
        increment(byComponent, component);
    }
    for (const diagnostic of snapshot.diagnostics) increment(byCode, diagnostic.code);
    const comparison = base && compareEvaluations(base.evaluation, head.evaluation);
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
          rulesChanged: comparison.rulesChanged,
          hierarchyChanged: comparison.hierarchyChanged,
          newCount: comparison.newFindings.length,
          resolvedCount: comparison.resolvedFindings.length
        }
      })
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
    return { identity, snapshotIdentity, ...loaded };
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
