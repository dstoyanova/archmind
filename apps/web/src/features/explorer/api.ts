import {
  componentDetailSchema,
  componentFilesPageSchema,
  componentGraphSchema,
  dependencyEvidencePageSchema,
  diagnosticsPageSchema,
  explorerErrorSchema,
  fileGraphSchema,
  snapshotListSchema,
  snapshotOverviewSchema
} from "@archmind/contracts";

export const snapshotPath = "/api/workspaces/local/snapshots";

async function request(url: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(10_000);
  const response = await globalThis.fetch(url, {
    cache: "no-store",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  });
  if (!response.ok) {
    const body = explorerErrorSchema.safeParse(await response.json());
    throw new Error(body.success ? body.data.error.message : "The snapshot API request failed.");
  }
  return response.json();
}

export async function fetchSnapshots(origin = "", cursor?: string) {
  const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
  return snapshotListSchema.parse(await request(`${origin}${snapshotPath}${query}`));
}

export async function fetchGraph(id: string, options: URLSearchParams, signal: AbortSignal) {
  return componentGraphSchema.parse(
    await request(`${snapshotPath}/${encodeURIComponent(id)}/graph?${options}`, signal)
  );
}

export async function fetchOverview(id: string, signal: AbortSignal) {
  return snapshotOverviewSchema.parse(
    await request(`${snapshotPath}/${encodeURIComponent(id)}`, signal)
  );
}

function snapshotRequest(
  id: string,
  resource: string,
  query: URLSearchParams,
  signal: AbortSignal
) {
  return request(`${snapshotPath}/${encodeURIComponent(id)}/${resource}?${query}`, signal);
}

function pageQuery(cursor: string | null) {
  const query = new URLSearchParams();
  if (cursor) query.set("cursor", cursor);
  return query;
}

export async function fetchDiagnostics(id: string, cursor: string | null, signal: AbortSignal) {
  return diagnosticsPageSchema.parse(
    await snapshotRequest(id, "diagnostics", pageQuery(cursor), signal)
  );
}

export async function fetchComponentDetail(
  id: string,
  component: string,
  projection: string,
  signal: AbortSignal
) {
  return componentDetailSchema.parse(
    await snapshotRequest(
      id,
      `components/${encodeURIComponent(component)}`,
      new URLSearchParams(projection),
      signal
    )
  );
}

export async function fetchComponentFiles(
  id: string,
  component: string,
  cursor: string | null,
  signal: AbortSignal
) {
  return componentFilesPageSchema.parse(
    await snapshotRequest(
      id,
      `components/${encodeURIComponent(component)}/files`,
      pageQuery(cursor),
      signal
    )
  );
}

export async function fetchEvidence(
  id: string,
  from: string,
  to: string,
  projection: string,
  cursor: string | null,
  signal: AbortSignal
) {
  const query = new URLSearchParams(projection);
  query.set("from", from);
  query.set("to", to);
  if (cursor) query.set("cursor", cursor);
  return dependencyEvidencePageSchema.parse(
    await snapshotRequest(id, "dependencies", query, signal)
  );
}

export async function fetchFileGraph(
  id: string,
  component: string,
  projection: string,
  signal: AbortSignal
) {
  const query = new URLSearchParams(projection);
  query.set("level", "file");
  query.set("componentId", component);
  return fileGraphSchema.parse(await snapshotRequest(id, "graph", query, signal));
}
