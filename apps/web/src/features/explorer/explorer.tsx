"use client";

import {
  MAX_PROJECTION_EXPANSIONS,
  type ComponentGraph,
  type FindingSummary,
  type SnapshotList
} from "@archmind/contracts";
import { Network } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchGraph, fetchSnapshots } from "./api";
import { graphEdges } from "./edges";
import { findingComponents, FindingsPanel, type ReadySnapshot } from "./findings-panel";
import { componentLabels } from "./labels";
import { ComponentPanel } from "./component-panel";
import { SnapshotOverviewPanel } from "./snapshot-overview";
import type { ExplorerNode } from "./layout";
import { parseThemePreference, themeCookie, type ThemePreference } from "./theme";

const GraphCanvas = dynamic(() => import("./graph-canvas").then((module) => module.GraphCanvas), {
  ssr: false,
  loading: () => <Skeleton className="h-full" aria-label="Loading graph canvas" />
});
const FileDrilldown = dynamic(
  () => import("./file-drilldown").then((module) => module.FileDrilldown),
  {
    ssr: false,
    loading: () => <p role="status">Loading file graph...</p>
  }
);
const roles = ["source", "test", "story", "script", "config"] as const;

function fetchFullGraph(id: string, signal: AbortSignal) {
  return fetchGraph(
    id,
    new URLSearchParams({ depth: String(Number.MAX_SAFE_INTEGER), includeEmptyComponents: "true" }),
    signal
  );
}
type Role = (typeof roles)[number];
type Component = ComponentGraph["components"][number];
type FindingJump = {
  scope: NonNullable<FindingSummary["graphScope"]>;
  expanded: ReadonlySet<string>;
  focus: string | null;
};
type Listing = SnapshotList | { error: string };
const preferredSnapshotId = ({ items }: SnapshotList) =>
  (items.find((item) => item.status === "ready") ?? items[0])?.id;
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

function planFindingJump(
  finding: FindingSummary,
  index: ReadonlyMap<string, Component>,
  expanded: ReadonlySet<string>
): FindingJump {
  if (!finding.graphScope)
    throw new Error(
      "This evaluation does not record graph scope. Run archmind check again to enable graph navigation."
    );
  const subjects = findingComponents(finding);
  const next = new Set(expanded);
  for (const id of subjects) {
    const component = index.get(id);
    if (!component) throw new Error("The finding subject is not available in this snapshot.");
    let parent = index.get(component.parentId ?? "");
    while (parent && parent.depth >= 1) {
      next.add(parent.id);
      parent = index.get(parent.parentId ?? "");
    }
  }
  if (next.size > MAX_PROJECTION_EXPANSIONS)
    throw new Error("Collapse some graph components before jumping to this finding.");
  return { scope: finding.graphScope, expanded: next, focus: subjects[0] ?? null };
}

function focusGraph() {
  globalThis.requestAnimationFrame(() => {
    const graph = globalThis.document.getElementById("architecture-graph");
    graph?.scrollIntoView({ block: "nearest" });
    graph?.focus({ preventScroll: true });
  });
}

export function Explorer({
  initial,
  initialTheme
}: {
  initial: Listing;
  initialTheme: ThemePreference;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const [listing, setListing] = useState(initial);
  const [selectedId, setSelectedId] = useState(() =>
    "items" in initial ? preferredSnapshotId(initial) : undefined
  );
  const [listPending, setListPending] = useState(false);
  const [listError, setListError] = useState<string>();
  const [jump, setJump] = useState<FindingJump>();
  const selected =
    "items" in listing ? listing.items.find(({ id }) => id === selectedId) : undefined;

  async function loadList(cursor?: string) {
    setListPending(true);
    setListError(undefined);
    try {
      let page = await fetchSnapshots("", cursor);
      const previousItems = "items" in listing ? listing.items : [];
      const items = cursor ? [...previousItems, ...page.items] : [...page.items];
      if (!cursor) {
        // A refresh starts at page one; the active snapshot may be on a later page.
        while (
          page.nextCursor &&
          (items.length < previousItems.length ||
            (selectedId !== undefined && !items.some(({ id }) => id === selectedId)))
        ) {
          page = await fetchSnapshots("", page.nextCursor);
          items.push(...page.items);
        }
      }
      const next = {
        items: [...new Map(items.map((item) => [item.id, item])).values()],
        nextCursor: page.nextCursor
      };
      setListing(next);
      setSelectedId((id) =>
        items.some((item) => item.id === id) ? id : preferredSnapshotId(next)
      );
    } catch (error) {
      setListError(errorMessage(error));
    } finally {
      setListPending(false);
    }
  }

  const listProblem = listError ?? ("error" in listing ? listing.error : undefined);

  function changeTheme(value: string) {
    const preference = parseThemePreference(value);
    globalThis.document.documentElement.dataset.theme = preference;
    globalThis.document.cookie = `${themeCookie}=${preference}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setTheme(preference);
  }

  return (
    <main className="mx-auto max-w-[1740px] space-y-5 px-4 py-6 sm:px-8">
      <header className="flex flex-wrap items-center gap-3">
        <div className="rounded-lg bg-primary p-2 text-primary-foreground">
          <Network aria-hidden="true" size={24} />
        </div>
        <div>
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            ArchMind / Local workspace
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Architecture explorer</h1>
        </div>
        <div className="ml-auto space-y-1.5">
          <Label htmlFor="theme">Theme</Label>
          <Select value={theme} onValueChange={changeTheme}>
            <SelectTrigger id="theme" className="min-w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </header>
      <section aria-label="Snapshots" className="flex flex-wrap items-end gap-3">
        {"items" in listing && listing.items.length > 0 && (
          <div className="space-y-1.5">
            <Label htmlFor="snapshot">Snapshot</Label>
            <Select
              value={selectedId}
              onValueChange={(id) => {
                setJump(undefined);
                setSelectedId(id);
              }}
              disabled={listPending}
            >
              <SelectTrigger id="snapshot" className="min-w-60 max-w-[85vw]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {listing.items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                    {item.status === "invalid" ? " (invalid)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button variant="outline" disabled={listPending} onClick={() => void loadList()}>
          Refresh snapshots
        </Button>
        {"items" in listing && listing.nextCursor && (
          <Button
            variant="outline"
            disabled={listPending}
            onClick={() => void loadList(listing.nextCursor ?? undefined)}
          >
            Load more snapshots
          </Button>
        )}
        {listPending && (
          <span role="status" className="text-sm text-muted-foreground">
            Loading snapshots…
          </span>
        )}
      </section>
      {listProblem && (
        <Alert variant="destructive">
          <AlertTitle>Could not load snapshots</AlertTitle>
          <AlertDescription>{listProblem}</AlertDescription>
        </Alert>
      )}
      {"items" in listing && listing.items.length === 0 && !listPending && (
        <Alert>
          <AlertTitle>No snapshots found</AlertTitle>
          <AlertDescription>
            Run the ArchMind CLI and save its snapshot JSON in the configured directory, then
            refresh.
          </AlertDescription>
        </Alert>
      )}
      {selected?.status === "invalid" && (
        <Alert variant="destructive">
          <AlertTitle>Invalid snapshot</AlertTitle>
          <AlertDescription>{selected.reason}</AlertDescription>
        </Alert>
      )}
      {selected?.status === "ready" && (
        <div className="space-y-4" key={`${selected.id}:${selected.contentHash}`}>
          <SnapshotOverviewPanel id={selected.id} />
          <SnapshotGraph
            id={selected.id}
            theme={theme}
            initialJump={jump}
            onOpenSnapshot={(snapshot, plan) => {
              setListing((previous) =>
                "items" in previous && !previous.items.some(({ id }) => id === snapshot.id)
                  ? { ...previous, items: [...previous.items, snapshot] }
                  : previous
              );
              setJump(plan);
              setSelectedId(snapshot.id);
              focusGraph();
            }}
          />
        </div>
      )}
    </main>
  );
}

function SnapshotGraph({
  id,
  theme,
  initialJump,
  onOpenSnapshot
}: {
  id: string;
  theme: ThemePreference;
  initialJump: FindingJump | undefined;
  onOpenSnapshot: (snapshot: ReadySnapshot, plan: FindingJump) => void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => initialJump?.expanded ?? new Set()
  );
  const [expansionBlocked, setExpansionBlocked] = useState(false);
  const [enabledRoles, setRoles] = useState<readonly Role[]>(
    initialJump?.scope.roles ?? ["source"]
  );
  const [showEmpty, setShowEmpty] = useState(initialJump !== undefined);
  const [typeOnly, setTypeOnly] = useState(initialJump?.scope.includeTypeOnly ?? true);
  const [internal, setInternal] = useState(true);
  const [external, setExternal] = useState(true);
  const [search, setSearch] = useState("");
  const [focused, setFocused] = useState<string | null>(initialJump?.focus ?? null);
  const [detailId, setDetailId] = useState<string>();
  const [showFiles, setShowFiles] = useState(false);
  const [showList, setShowList] = useState(false);
  const [findings, setFindings] = useState<FindingSummary[]>([]);
  const [scopedCatalog, setScopedCatalog] = useState<{ query: string; components: Component[] }>();
  const [fullCatalog, setFullCatalog] = useState<Component[]>();
  const [catalogError, setCatalogError] = useState<string>();
  const [fullCatalogError, setFullCatalogError] = useState<string>();
  const [result, setResult] = useState<{
    graph: ComponentGraph;
    nodes: ExplorerNode[];
    key: string;
  }>();
  const [error, setError] = useState<{ message: string; key: string }>();
  const [attempt, setAttempt] = useState(0);
  const roleQuery = useMemo(() => {
    const params = new URLSearchParams({ includeEmptyComponents: String(showEmpty) });
    for (const role of enabledRoles) params.append("roles", role);
    return params.toString();
  }, [enabledRoles, showEmpty]);
  const query = useMemo(() => {
    const params = new URLSearchParams(roleQuery);
    params.set("includeTypeOnly", String(typeOnly));
    for (const component of expanded) params.append("expand", component);
    return params.toString();
  }, [roleQuery, expanded, typeOnly]);
  const generation = JSON.stringify([query, external, attempt]);
  const catalog = scopedCatalog?.query === roleQuery ? scopedCatalog.components : undefined;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(roleQuery);
    params.set("depth", String(Number.MAX_SAFE_INTEGER));
    void fetchGraph(id, params, controller.signal).then(
      (graph) => {
        if (!controller.signal.aborted) {
          setScopedCatalog({ query: roleQuery, components: graph.components });
          setCatalogError(undefined);
        }
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) setCatalogError(errorMessage(reason));
      }
    );
    return () => controller.abort();
  }, [id, attempt, roleQuery]);

  const needsFullCatalog = findings.length > 0 && fullCatalog === undefined;
  useEffect(() => {
    if (!needsFullCatalog) return;
    const controller = new AbortController();
    void fetchFullGraph(id, controller.signal).then(
      (graph) => {
        if (!controller.signal.aborted) {
          setFullCatalog(graph.components);
          setFullCatalogError(undefined);
        }
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) setFullCatalogError(errorMessage(reason));
      }
    );
    return () => controller.abort();
  }, [id, attempt, needsFullCatalog]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const [graph, { layoutGraph }] = await Promise.all([
          fetchGraph(id, new URLSearchParams(query), controller.signal),
          import("./layout")
        ]);
        if (controller.signal.aborted) return;
        const nodes = await layoutGraph(external ? graph : { ...graph, externalDependencies: [] });
        if (!controller.signal.aborted) setResult({ graph, nodes, key: generation });
      } catch (reason) {
        if (!controller.signal.aborted)
          setError({ message: errorMessage(reason), key: generation });
      }
    })();
    return () => controller.abort();
  }, [id, query, external, generation]);

  const completeCatalog = fullCatalog ?? catalog;
  const componentIndex = useMemo(
    () => new Map(completeCatalog?.map((component) => [component.id, component])),
    [completeCatalog]
  );
  const expandable = useMemo(
    () => new Set(catalog?.flatMap(({ parentId }) => (parentId ? [parentId] : []))),
    [catalog]
  );
  const visible = result?.graph.components;
  const labels = useMemo(
    () => componentLabels(completeCatalog ?? visible ?? []),
    [completeCatalog, visible]
  );
  const findingCounts = useMemo(() => {
    const visibleIds = new Set(visible?.map(({ id }) => id));
    const counts = new Map<string, number>();
    const nearest = new Map<string, string | undefined>();
    for (const finding of findings) {
      const targets = new Set<string>();
      for (const id of findingComponents(finding)) {
        if (!nearest.has(id)) {
          let candidate: string | undefined = id;
          while (candidate && !visibleIds.has(candidate))
            candidate = componentIndex.get(candidate)?.parentId;
          nearest.set(id, candidate);
        }
        const target = nearest.get(id);
        if (target) targets.add(target);
      }
      for (const target of targets) counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    return counts;
  }, [componentIndex, findings, visible]);
  const detail = detailId
    ? (componentIndex.get(detailId) ?? visible?.find((item) => item.id === detailId))
    : undefined;
  const currentError = error?.key === generation ? error.message : undefined;
  const busy = result?.key !== generation && !currentError;
  const results = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term
      ? (catalog ?? result?.graph.components ?? []).filter(
          ({ name, paths }) =>
            name.toLowerCase().includes(term) ||
            paths.some((path) => path.toLowerCase().includes(term))
        )
      : [];
  }, [catalog, result, search]);
  const edgeView = useMemo(() => {
    if (!result) return { edges: [], cycles: new Map<string, "type-cycle" | "runtime-cycle">() };
    return {
      edges: graphEdges({
        ...result.graph,
        dependencies: internal ? result.graph.dependencies : [],
        externalDependencies: external ? result.graph.externalDependencies : []
      }),
      cycles: new Map(
        internal
          ? result.graph.cycles.flatMap(({ memberIds, typeOnly: types }) =>
              memberIds.map((member): [string, "type-cycle" | "runtime-cycle"] => [
                member,
                types ? "type-cycle" : "runtime-cycle"
              ])
            )
          : []
      )
    };
  }, [result, internal, external]);

  function reveal(component: Component) {
    const next = new Set(expanded);
    let parent = componentIndex.get(component.parentId ?? "");
    while (parent && parent.depth >= 1) {
      next.add(parent.id);
      parent = componentIndex.get(parent.parentId ?? "");
    }
    if (next.size > MAX_PROJECTION_EXPANSIONS) {
      setExpansionBlocked(true);
      return;
    }
    setExpansionBlocked(false);
    setFocused(component.id);
    if (next.size !== expanded.size) setExpanded(next);
  }

  function toggle(componentId: string) {
    if (!expanded.has(componentId) && expanded.size >= MAX_PROJECTION_EXPANSIONS) {
      setExpansionBlocked(true);
      return;
    }
    setExpansionBlocked(false);
    setFocused(null);
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(componentId)) next.add(componentId);
      else {
        for (const candidate of previous) {
          let ancestor = componentIndex.get(candidate)?.parentId;
          while (ancestor) {
            if (ancestor === componentId) {
              next.delete(candidate);
              break;
            }
            ancestor = componentIndex.get(ancestor)?.parentId;
          }
        }
      }
      return next;
    });
  }

  async function jumpToFinding(
    finding: FindingSummary,
    target?: ReadySnapshot
  ): Promise<string | undefined> {
    try {
      if (target && target.id !== id) {
        const graph = await fetchFullGraph(target.id, AbortSignal.timeout(10_000));
        onOpenSnapshot(
          target,
          planFindingJump(
            finding,
            new Map(graph.components.map((component) => [component.id, component])),
            new Set()
          )
        );
        return;
      }
      let index = componentIndex;
      if (!fullCatalog && !findingComponents(finding).every((subject) => index.has(subject))) {
        const graph = await fetchFullGraph(id, AbortSignal.timeout(10_000));
        index = new Map(graph.components.map((component) => [component.id, component]));
        setFullCatalog(graph.components);
        setFullCatalogError(undefined);
      }
      const plan = planFindingJump(finding, index, expanded);
      setExpanded(plan.expanded);
      setRoles(plan.scope.roles);
      setTypeOnly(plan.scope.includeTypeOnly);
      setShowEmpty(true);
      setInternal(true);
      setExternal(true);
      setFocused(plan.focus);
      setShowList(false);
      setShowFiles(false);
      focusGraph();
    } catch (reason) {
      return errorMessage(reason);
    }
  }

  return (
    <div
      className={`grid gap-4 ${detail && !showFiles ? "lg:grid-cols-[17rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)_20rem]" : "lg:grid-cols-[17rem_minmax(0,1fr)]"}`}
    >
      <Card>
        <CardContent className="space-y-5">
          {expansionBlocked && (
            <Alert variant="destructive">
              <AlertTitle>Expansion limit reached</AlertTitle>
              <AlertDescription>
                At most {MAX_PROJECTION_EXPANSIONS} components can be expanded at once. Collapse
                some components and try again.
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-2">
            <Label htmlFor="component-search">Find a component</Label>
            <Input
              id="component-search"
              type="search"
              placeholder="Search name or path"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search.trim() &&
              (results.length ? (
                <ul aria-label="Search results" className="max-h-44 overflow-y-auto">
                  {results.map((component) => (
                    <li key={component.id}>
                      <Button
                        variant="ghost"
                        className="w-full justify-start overflow-hidden"
                        onClick={() => reveal(component)}
                      >
                        <span className="truncate" title={component.paths.join(", ")}>
                          {component.name} / {component.paths[0]}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p role="status" className="text-sm text-muted-foreground">
                  {catalog
                    ? `No matching components.${showEmpty ? "" : " Components without files in the selected roles are hidden."}`
                    : "Searching available components…"}
                </p>
              ))}
            {(catalogError || (needsFullCatalog && fullCatalogError)) && (
              <Alert variant="destructive">
                <AlertDescription>
                  {catalogError
                    ? `Could not load all component names. ${catalogError}`
                    : `Could not load the component hierarchy for finding highlights. ${fullCatalogError}`}
                  <Button variant="ghost" onClick={() => setAttempt((value) => value + 1)}>
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">Dependencies</legend>
            <Filter label="Internal dependencies" checked={internal} onChange={setInternal} />
            <Filter label="External dependencies" checked={external} onChange={setExternal} />
            <Filter label="Include type-only imports" checked={typeOnly} onChange={setTypeOnly} />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-semibold">Import source roles</legend>
            {roles.map((role) => (
              <Filter
                key={role}
                label={role}
                checked={enabledRoles.includes(role)}
                disabled={enabledRoles.length === 1 && enabledRoles.includes(role)}
                onChange={(checked) =>
                  setRoles((previous) =>
                    checked ? [...previous, role] : previous.filter((item) => item !== role)
                  )
                }
              />
            ))}
            <Filter
              label="Show components without files in these roles"
              checked={showEmpty}
              onChange={setShowEmpty}
            />
            {!showEmpty && (
              <p className="text-xs text-muted-foreground">
                Components with no file in the selected roles, such as test fixtures, are hidden
                unless a dependency points at them.
              </p>
            )}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="cycle-legend runtime-cycle">
              Runtime cycle
            </Badge>
            <Badge variant="outline" className="cycle-legend type-cycle">
              Type-only cycle
            </Badge>
          </div>
        </CardContent>
      </Card>
      {showFiles && detail ? (
        <FileDrilldown
          key={JSON.stringify([detail.id, query])}
          id={id}
          component={detail.id}
          name={labels.get(detail.id) ?? detail.name}
          projection={query}
          theme={theme}
          onBack={() => setShowFiles(false)}
        />
      ) : (
        <div className="min-w-0 space-y-2">
          <Button variant="outline" aria-expanded={showList} onClick={() => setShowList(!showList)}>
            {showList ? "Show component graph" : "Show component list"}
          </Button>
          {showList && (
            <section
              aria-label="Component graph list"
              aria-busy={busy}
              className="max-h-[70dvh] space-y-2 overflow-auto rounded-xl border p-3"
            >
              {busy && <p role="status">Loading components...</p>}
              {!busy && !currentError && !visible?.length && <p>No components found.</p>}
              <ul className="space-y-2">
                {visible?.map((component) => (
                  <li key={component.id} className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setDetailId(component.id)}>
                      {labels.get(component.id)} details
                    </Button>
                    <span className="text-sm break-all">
                      {component.paths.join(", ")} · Level {component.depth}
                    </span>
                    {expandable.has(component.id) && component.depth >= 1 && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-expanded={expanded.has(component.id)}
                        onClick={() => toggle(component.id)}
                      >
                        {expanded.has(component.id) ? "Collapse" : "Expand"}{" "}
                        {labels.get(component.id)}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section
            hidden={showList && !currentError}
            aria-label="Architecture graph"
            id="architecture-graph"
            tabIndex={-1}
            aria-busy={busy}
            className="relative h-[70dvh] min-h-[480px] overflow-hidden rounded-xl border bg-background lg:h-[calc(100dvh-11rem)]"
          >
            {busy && (
              <Badge role="status" className="absolute top-3 right-3 z-10">
                Loading graph…
              </Badge>
            )}
            {currentError ? (
              <Alert variant="destructive" className="m-4 w-auto">
                <AlertTitle>Could not load graph</AlertTitle>
                <AlertDescription>
                  {currentError}
                  <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
                    Retry graph
                  </Button>
                </AlertDescription>
              </Alert>
            ) : result?.nodes.length ? (
              <GraphCanvas
                theme={theme}
                nodes={result.nodes}
                edges={edgeView.edges}
                interaction={{
                  expandable,
                  expanded,
                  cycles: edgeView.cycles,
                  findingCounts,
                  focused,
                  toggle,
                  select: setDetailId
                }}
              />
            ) : result ? (
              <Alert className="m-4 w-auto">
                <AlertTitle>No components found</AlertTitle>
                <AlertDescription>
                  This snapshot has no visible architecture components.
                </AlertDescription>
              </Alert>
            ) : (
              <Skeleton className="absolute inset-3" aria-label="Loading architecture graph" />
            )}
          </section>
        </div>
      )}
      {detail && !showFiles && (
        <ComponentPanel
          key={JSON.stringify([detail.id, query])}
          id={id}
          component={detail.id}
          name={labels.get(detail.id) ?? detail.name}
          projection={query}
          labels={labels}
          onSelect={(componentId) => {
            const child = componentIndex.get(componentId);
            if (child) reveal(child);
            setDetailId(componentId);
          }}
          onClose={() => setDetailId(undefined)}
          onDrillDown={() => setShowFiles(true)}
        />
      )}
      <div className="min-w-0 lg:col-span-full">
        <FindingsPanel
          snapshotId={id}
          labels={labels}
          onHighlight={setFindings}
          onJump={jumpToFinding}
        />
      </div>
    </div>
  );
}

function Filter({
  label,
  checked,
  onChange,
  disabled
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}) {
  return (
    <Label className="cursor-pointer font-normal">
      <Checkbox
        checked={checked}
        disabled={disabled ?? false}
        onCheckedChange={(value) => onChange(value === true)}
      />
      {label}
    </Label>
  );
}
