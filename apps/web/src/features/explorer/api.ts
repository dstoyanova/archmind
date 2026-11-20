import { componentGraphSchema, explorerErrorSchema, snapshotListSchema } from "@archmind/contracts";

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
