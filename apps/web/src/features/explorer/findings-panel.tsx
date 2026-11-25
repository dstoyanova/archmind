"use client";

import type { FindingSummary, SnapshotList } from "@archmind/contracts";
import { useCallback, useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { fetchEvaluations, fetchFinding, fetchFindings, fetchHealth, fetchSnapshots } from "./api";
import { diagnosticEffects } from "./coverage";
import { LoadContent, LoadPage } from "./detail-content";

const none = "__none__";
export type ReadySnapshot = Extract<SnapshotList["items"][number], { status: "ready" }>;
const nextPage = (page: { nextCursor: string | null }) => page.nextCursor;

async function evaluationOptions(id: string, signal: AbortSignal) {
  const first = await fetchEvaluations(id, null, signal);
  const items = [...first.items];
  for (let cursor = first.nextCursor; cursor;) {
    const page = await fetchEvaluations(id, cursor, signal);
    items.push(...page.items);
    cursor = page.nextCursor;
  }
  return { items, issues: first.issues };
}

export function findingComponents({ subject }: FindingSummary): string[] {
  switch (subject.kind) {
    case "components":
      return subject.componentIds;
    case "dependency":
      return [subject.fromComponentId, subject.toComponentId];
    case "external-package":
      return [subject.componentId];
  }
}

function Choice({
  label,
  value,
  options,
  onChange,
  disabled
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value || none}
      onValueChange={(next) => onChange(next === none ? "" : next)}
      disabled={disabled === true}
    >
      <SelectTrigger aria-label={label} className="w-full min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value || none}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FindingsPanel({
  snapshotId,
  labels,
  onHighlight,
  onJump
}: {
  snapshotId: string;
  labels: ReadonlyMap<string, string>;
  onHighlight: (findings: FindingSummary[]) => void;
  onJump: (finding: FindingSummary, target?: ReadySnapshot) => Promise<string | undefined>;
}) {
  const [selected, select] = useState("");
  const [baseline, setBaseline] = useState("");
  const [baselineSnapshot, setBaselineSnapshot] = useState<ReadySnapshot>();
  const [findings, setFindings] = useState<FindingSummary>();
  const [jumpError, setJumpError] = useState<string>();
  const loadEvaluations = useCallback(
    (signal: AbortSignal) => evaluationOptions(snapshotId, signal),
    [snapshotId]
  );
  const loadBaselineEvaluations = useCallback(
    (signal: AbortSignal) => evaluationOptions(baselineSnapshot?.id ?? snapshotId, signal),
    [baselineSnapshot, snapshotId]
  );
  const loadSnapshots = useCallback(async (signal: AbortSignal) => {
    const snapshots = [];
    let cursor: string | undefined;
    do {
      const page = await fetchSnapshots("", cursor, signal);
      snapshots.push(...page.items.filter((item) => item.status === "ready"));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return snapshots;
  }, []);

  useEffect(() => {
    onHighlight([]);
    if (!selected) return;
    const controller = new AbortController();
    void (async () => {
      const items: FindingSummary[] = [];
      let cursor: string | null = null;
      do {
        const page = await fetchFindings(selected, "", cursor, controller.signal);
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      if (!controller.signal.aborted) onHighlight(items);
    })().catch((reason: unknown) => {
      if (!controller.signal.aborted)
        setJumpError(reason instanceof Error ? reason.message : "Could not load graph highlights.");
    });
    return () => controller.abort();
  }, [selected, onHighlight]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Governance findings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <LoadContent load={loadEvaluations}>
          {({ items, issues }) => (
            <>
              {issues.length > 0 && (
                <Alert>
                  <AlertDescription>
                    {issues.map(({ id, label, reason }) => (
                      <p key={id}>
                        {label}: {reason}
                      </p>
                    ))}
                  </AlertDescription>
                </Alert>
              )}
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No evaluations for this snapshot. Run archmind check and place the evaluation next
                  to the snapshot.
                </p>
              ) : (
                <Choice
                  label="Evaluation"
                  value={selected}
                  options={[
                    { value: "", label: "Select an evaluation" },
                    ...items.map(({ id, label }) => ({ value: id, label }))
                  ]}
                  onChange={(value) => {
                    select(value);
                    setFindings(undefined);
                    setJumpError(undefined);
                    if (value === baseline) setBaseline("");
                  }}
                />
              )}
            </>
          )}
        </LoadContent>
        {selected && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <LoadContent load={loadSnapshots}>
                {(snapshots) => (
                  <Choice
                    label="Baseline snapshot"
                    value={baselineSnapshot?.id ?? ""}
                    options={[
                      { value: "", label: "No baseline snapshot" },
                      ...snapshots.map(({ id, label }) => ({ value: id, label }))
                    ]}
                    onChange={(value) => {
                      setBaselineSnapshot(snapshots.find(({ id }) => id === value));
                      setBaseline("");
                      setFindings(undefined);
                    }}
                  />
                )}
              </LoadContent>
              {baselineSnapshot && (
                <LoadContent key={baselineSnapshot.id} load={loadBaselineEvaluations}>
                  {({ items }) => (
                    <Choice
                      label="Baseline evaluation"
                      value={baseline}
                      options={[
                        { value: "", label: "No baseline evaluation" },
                        ...items
                          .filter(({ id }) => id !== selected)
                          .map(({ id, label }) => ({ value: id, label }))
                      ]}
                      onChange={(value) => {
                        setBaseline(value);
                        setFindings(undefined);
                      }}
                    />
                  )}
                </LoadContent>
              )}
            </div>
            <EvaluationFindings
              key={`${selected}:${baseline}`}
              id={selected}
              baseline={baseline}
              labels={labels}
              onSelect={(finding) => {
                setFindings(finding);
                setJumpError(undefined);
              }}
            />
            {findings && (
              <FindingEvidence
                key={`${findings.evaluationId}:${findings.id}`}
                finding={findings}
                onJump={() => {
                  void onJump(
                    findings,
                    findings.status === "resolved" ? baselineSnapshot : undefined
                  ).then(setJumpError);
                }}
              />
            )}
            {jumpError && (
              <Alert variant="destructive">
                <AlertDescription>{jumpError}</AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function EvaluationFindings({
  id,
  baseline,
  labels,
  onSelect
}: {
  id: string;
  baseline: string;
  labels: ReadonlyMap<string, string>;
  onSelect: (finding: FindingSummary) => void;
}) {
  const [severity, setSeverity] = useState("");
  const [rule, setRule] = useState("");
  const [status, setStatus] = useState("");
  const loadHealth = useCallback(
    (signal: AbortSignal) => fetchHealth(id, baseline, signal),
    [id, baseline]
  );
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ baseline, severity, ruleId: rule, status })) {
    if (value) query.set(key, value);
  }
  const filters = query.toString();
  const load = useCallback(
    (cursor: string | null, signal: AbortSignal) => fetchFindings(id, filters, cursor, signal),
    [id, filters]
  );
  const loadBaseHealth = useCallback(
    (signal: AbortSignal) => fetchHealth(baseline, "", signal),
    [baseline]
  );
  return (
    <section aria-label="Findings and health" className="space-y-3">
      <LoadContent load={loadHealth}>
        {(health) => (
          <>
            <section aria-label="Evaluation health" className="space-y-1 text-sm">
              <h3 className="font-semibold">Evaluation health</h3>
              <p>
                {health.bySeverity.error} errors · {health.bySeverity.warning} warnings
              </p>
              {health.byRule.length > 0 && (
                <p>
                  By rule:{" "}
                  {health.byRule.map(({ ruleId, count }) => `${ruleId}: ${count}`).join(", ")}
                </p>
              )}
              {health.topComponents.length > 0 && (
                <p>
                  Most affected:{" "}
                  {health.topComponents
                    .map(
                      ({ componentId, paths, count }) =>
                        `${labels.get(componentId) ?? paths[0] ?? componentId}: ${count}`
                    )
                    .join(", ")}
                </p>
              )}
              {health.comparison && (
                <p>
                  {health.comparison.newCount} new · {health.comparison.resolvedCount} resolved
                  {health.comparison.rulesChanged ? " · Rules changed" : ""}
                  {health.comparison.hierarchyChanged ? " · Hierarchy changed" : ""}
                </p>
              )}
              <h4 className="font-medium">Analysis coverage</h4>
              <p>
                {(health.coverage.unresolvedRate * 100).toFixed(2)}% unresolved ·{" "}
                {health.coverage.diagnosticTotal} diagnostics
              </p>
              {Object.entries(health.coverage.diagnosticsByCode).map(([code, count]) => (
                <p key={code}>
                  {code}: {count}. {diagnosticEffects[code]}
                </p>
              ))}
            </section>
            <div className="grid gap-2 sm:grid-cols-3">
              <Choice
                label="Severity"
                value={severity}
                options={[
                  { value: "", label: "All severities" },
                  { value: "error", label: "Error" },
                  { value: "warning", label: "Warning" }
                ]}
                onChange={setSeverity}
              />
              {status === "resolved" ? (
                <LoadContent load={loadBaseHealth}>
                  {(base) => <RuleFilter value={rule} rules={base.byRule} onChange={setRule} />}
                </LoadContent>
              ) : (
                <RuleFilter value={rule} rules={health.byRule} onChange={setRule} />
              )}
              <Choice
                label="Status"
                value={status}
                options={[
                  { value: "", label: "All statuses" },
                  ...["new", "existing", "resolved"].map((value) => ({ value, label: value }))
                ]}
                onChange={(value) => {
                  setStatus(value);
                  setRule("");
                }}
                disabled={!baseline}
              />
            </div>
          </>
        )}
      </LoadContent>
      <LoadPage
        key={filters}
        load={load}
        nextCursor={nextPage}
        render={(page) =>
          page.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matching findings.</p>
          ) : (
            <ul aria-label="Findings" className="space-y-1">
              {page.items.map((item) => (
                <li key={item.id}>
                  <Button
                    variant="outline"
                    className="h-auto w-full justify-start whitespace-normal text-left"
                    onClick={() => onSelect(item)}
                  >
                    <Badge variant={item.severity === "error" ? "destructive" : "secondary"}>
                      {item.severity}
                    </Badge>
                    <span>
                      {item.ruleId}: {item.message}
                    </span>
                    {item.status && <Badge variant="outline">{item.status}</Badge>}
                  </Button>
                </li>
              ))}
            </ul>
          )
        }
      />
    </section>
  );
}

function RuleFilter({
  value,
  rules,
  onChange
}: {
  value: string;
  rules: readonly { ruleId: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Choice
      label="Rule"
      value={value}
      options={[
        { value: "", label: "All rules" },
        ...rules.map(({ ruleId }) => ({ value: ruleId, label: ruleId }))
      ]}
      onChange={onChange}
    />
  );
}

function FindingEvidence({ finding, onJump }: { finding: FindingSummary; onJump: () => void }) {
  const load = useCallback(
    (cursor: string | null, signal: AbortSignal) =>
      fetchFinding(finding.evaluationId, finding.id, cursor, signal),
    [finding]
  );
  return (
    <Card aria-label="Finding detail">
      <CardHeader>
        <CardTitle>{finding.ruleId}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p>{finding.message}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onJump}>Show on graph</Button>
          <Button asChild variant="outline">
            <a href="#finding-evidence">Jump to evidence</a>
          </Button>
        </div>
        <section
          id="finding-evidence"
          aria-label="Finding evidence"
          tabIndex={-1}
          className="space-y-2"
        >
          <h3 className="font-semibold">Evidence ({finding.evidenceTotal})</h3>
          <LoadPage
            load={load}
            nextCursor={(value) => value.evidence.nextCursor}
            render={({ evidence }) =>
              evidence.items.length === 0 ? (
                <p className="text-sm">No import evidence for this finding.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {evidence.items.map((item) => (
                    <li key={JSON.stringify(item)} className="break-all">
                      <code>
                        {item.filePath}:{item.line}:{item.column}
                      </code>{" "}
                      · {item.specifier} ({item.role}, {item.kind})
                    </li>
                  ))}
                </ul>
              )
            }
          />
        </section>
      </CardContent>
    </Card>
  );
}
