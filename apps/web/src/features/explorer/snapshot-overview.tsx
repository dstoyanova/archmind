"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchDiagnostics, fetchOverview } from "./api";
import { diagnosticEffects, resolutionEffects } from "./coverage";
import { LoadContent, LoadPage } from "./detail-content";

export function SnapshotOverviewPanel({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const overview = useCallback((signal: AbortSignal) => fetchOverview(id, signal), [id]);
  const diagnostics = useCallback(
    (cursor: string | null, signal: AbortSignal) => fetchDiagnostics(id, cursor, signal),
    [id]
  );

  return (
    <Card>
      <CardContent className="space-y-4">
        <Button
          variant="outline"
          aria-expanded={open}
          aria-controls="snapshot-overview"
          onClick={() => setOpen(!open)}
        >
          Snapshot overview
        </Button>
        <div id="snapshot-overview" hidden={!open}>
          {open && (
            <LoadContent load={overview}>
              {(snapshot) => {
                const { source } = snapshot;
                const fields: [string, string][] = [
                  ["Created", snapshot.createdAt],
                  ["Schema version", snapshot.schemaVersion],
                  ["Engine version", snapshot.engineVersion],
                  ["Parser version", snapshot.parserVersion],
                  ["Source", source.kind],
                  ["Source hash", source.sourceHash],
                  ["Content hash", snapshot.contentHash],
                  [
                    "Unresolved imports",
                    new Intl.NumberFormat(undefined, {
                      style: "percent",
                      maximumFractionDigits: 2
                    }).format(snapshot.resolutionStats.unresolvedRate)
                  ]
                ];
                if (source.commitSha) fields.push(["Commit", source.commitSha]);
                if (source.branch) fields.push(["Branch", source.branch]);
                if (source.commitTimestamp) fields.push(["Commit time", source.commitTimestamp]);
                if (source.workingTreeDirty !== undefined)
                  fields.push(["Working tree", source.workingTreeDirty ? "Modified" : "Clean"]);
                return (
                  <div className="space-y-4">
                    <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                      {fields.map(([label, value]) => (
                        <div key={label} className="min-w-0">
                          <dt className="font-semibold">{label}</dt>
                          <dd className="wrap-anywhere">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <h2 className="font-semibold">Import resolution</h2>
                    <p className="text-sm text-muted-foreground">
                      A low unresolved rate does not mean every import became an edge. Only some
                      resolutions can produce component dependencies.
                    </p>
                    <ul className="space-y-1 text-sm">
                      {Object.entries(snapshot.resolutionStats.countsByResolution).map(
                        ([kind, count]) => (
                          <li key={kind}>
                            <strong>{kind}</strong>: {count}
                            {resolutionEffects[kind] && (
                              <span className="text-muted-foreground">
                                {" "}
                                · {resolutionEffects[kind]}
                              </span>
                            )}
                          </li>
                        )
                      )}
                    </ul>
                    <h2 className="font-semibold">Diagnostics ({snapshot.diagnosticCount})</h2>
                    {snapshot.diagnosticCount === 0 ? (
                      <p className="text-sm">No diagnostics.</p>
                    ) : (
                      <>
                        <ul aria-label="Diagnostics by code" className="space-y-2 text-sm">
                          {Object.entries(snapshot.diagnosticCountsByCode).map(([code, count]) => (
                            <li key={code}>
                              <strong>{code}</strong>: {count}
                              {diagnosticEffects[code] && (
                                <div className="text-muted-foreground">
                                  {diagnosticEffects[code]}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                        <h3 className="font-semibold">Diagnostic details</h3>
                        <LoadPage
                          load={diagnostics}
                          nextCursor={(page) => page.nextCursor}
                          render={(page) => (
                            <ul className="space-y-2 text-sm">
                              {page.items.map((item, index) => (
                                <li key={index}>
                                  <strong>{item.code}</strong> ({item.severity}): {item.message}
                                  {item.filePath && (
                                    <div className="wrap-anywhere">
                                      {item.filePath}
                                      {item.line === undefined ? "" : `:${item.line}`}
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        />
                      </>
                    )}
                  </div>
                );
              }}
            </LoadContent>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
