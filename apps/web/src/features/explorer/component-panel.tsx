"use client";

import type { ComponentDetail } from "@archmind/contracts";
import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchComponentDetail, fetchComponentFiles, fetchEvidence } from "./api";
import { LoadContent, LoadPage } from "./detail-content";
import { componentLabels } from "./labels";

type Dependency = ComponentDetail["inboundDependencies"][number];

export function ComponentPanel({
  id,
  component,
  name,
  projection,
  labels,
  onSelect,
  onClose,
  onDrillDown
}: {
  id: string;
  component: string;
  name: string;
  projection: string;
  labels: ReadonlyMap<string, string>;
  onSelect: (id: string) => void;
  onClose: () => void;
  onDrillDown: () => void;
}) {
  const [edge, setEdge] = useState<Dependency>();
  const load = useCallback(
    (signal: AbortSignal) => fetchComponentDetail(id, component, projection, signal),
    [id, component, projection]
  );
  const files = useCallback(
    (cursor: string | null, signal: AbortSignal) =>
      fetchComponentFiles(id, component, cursor, signal),
    [id, component]
  );

  function dependencies(
    title: string,
    items: Dependency[],
    endpoint: "fromComponentId" | "toComponentId"
  ) {
    return (
      <section className="space-y-2">
        <h3 className="font-semibold">{title}</h3>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">None in this projection.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {items.map((item) => {
              const target = item[endpoint];
              const label = labels.get(target) ?? target;
              return (
                <li key={target}>
                  <p className="wrap-anywhere">
                    {label} ({item.weight} imports)
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEdge(item)}
                    aria-label={`View evidence: ${labels.get(item.fromComponentId) ?? item.fromComponentId} to ${labels.get(item.toComponentId) ?? item.toComponentId}`}
                  >
                    View evidence
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }

  return (
    <aside aria-label="Component details" className="min-w-0">
      <Card className="max-h-[80dvh] overflow-auto">
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="wrap-anywhere font-semibold">{name}</h2>
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close details
            </Button>
          </div>
          <Button size="sm" onClick={onDrillDown}>
            Open file graph
          </Button>
          <LoadContent load={load}>
            {(detail) => {
              const childLabels = componentLabels(detail.children);
              return (
                <div className="space-y-4">
                  <section className="space-y-2">
                    <h3 className="font-semibold">Metrics</h3>
                    <p className="text-sm text-muted-foreground">
                      Production graph at this component&apos;s depth. Unchanged by filters.
                    </p>
                    <dl className="grid grid-cols-2 gap-2 text-sm">
                      {(
                        [
                          ["Files", detail.component.metrics.fileCount],
                          ["Lines of code", detail.component.metrics.loc],
                          ["Fan-in", detail.component.metrics.fanIn],
                          ["Fan-out", detail.component.metrics.fanOut],
                          ["Instability", detail.component.metrics.instability.toFixed(2)]
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd className="font-semibold">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                  <section>
                    <h3 className="font-semibold">Child components</h3>
                    {detail.children.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No child components.</p>
                    ) : (
                      <ul>
                        {detail.children.map((child) => (
                          <li key={child.id}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="max-w-full"
                              onClick={() => onSelect(child.id)}
                            >
                              <span className="truncate">{childLabels.get(child.id)}</span>
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  {dependencies(
                    "Inbound dependencies",
                    detail.inboundDependencies,
                    "fromComponentId"
                  )}
                  {dependencies(
                    "Outbound dependencies",
                    detail.outboundDependencies,
                    "toComponentId"
                  )}
                  <section>
                    <h3 className="font-semibold">External dependencies</h3>
                    {detail.externalDependencies.length === 0 ? (
                      <p className="text-sm text-muted-foreground">None in this projection.</p>
                    ) : (
                      <ul className="text-sm">
                        {detail.externalDependencies.map((item) => (
                          <li key={item.packageName} className="wrap-anywhere">
                            {item.packageName} ({item.weight} imports)
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section aria-label="Component files">
                    <h3 className="font-semibold">Files in component subtree</h3>
                    <LoadPage
                      load={files}
                      nextCursor={(page) => page.nextCursor}
                      render={(page) =>
                        page.items.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No files.</p>
                        ) : (
                          <ul className="text-sm">
                            {page.items.map((file) => (
                              <li key={file.id} className="wrap-anywhere">
                                {file.path} ({file.role})
                              </li>
                            ))}
                          </ul>
                        )
                      }
                    />
                  </section>
                </div>
              );
            }}
          </LoadContent>
          {edge && (
            <Evidence
              key={JSON.stringify([edge.fromComponentId, edge.toComponentId])}
              id={id}
              edge={edge}
              projection={projection}
              labels={labels}
            />
          )}
        </CardContent>
      </Card>
    </aside>
  );
}

function Evidence({
  id,
  edge,
  projection,
  labels
}: {
  id: string;
  edge: Dependency;
  projection: string;
  labels: ReadonlyMap<string, string>;
}) {
  const { fromComponentId: from, toComponentId: to } = edge;
  const load = useCallback(
    (cursor: string | null, signal: AbortSignal) =>
      fetchEvidence(id, from, to, projection, cursor, signal),
    [id, from, to, projection]
  );
  return (
    <section
      aria-label="Dependency evidence"
      className="space-y-2"
      tabIndex={-1}
      ref={(node) => {
        node?.focus();
      }}
    >
      <h3 className="font-semibold">Dependency evidence</h3>
      <p className="text-sm wrap-anywhere">
        {labels.get(from) ?? from} → {labels.get(to) ?? to}
      </p>
      <LoadPage
        load={load}
        nextCursor={(page) => page.nextCursor}
        render={(page) =>
          page.items.length === 0 ? (
            <p className="text-sm">No evidence.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {page.items.map((item, index) => (
                <li key={index} className="wrap-anywhere">
                  <strong>
                    {item.filePath}:{item.line}
                  </strong>
                  <div>
                    {item.kind} · {item.role} · {item.specifier}
                  </div>
                </li>
              ))}
            </ul>
          )
        }
      />
    </section>
  );
}
