import { snapshotPath } from "@/features/explorer/api";
import { apiOrigin } from "@/features/explorer/api-origin";

export async function GET(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> }
): Promise<Response> {
  const { segments = [] } = await context.params;
  if (
    segments.length !== 0 &&
    (segments.length !== 2 || segments[1] !== "graph" || !/^[a-f0-9]{64}$/.test(segments[0] ?? ""))
  ) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Explorer route not found." } },
      { status: 404 }
    );
  }

  const path = [snapshotPath, ...segments.map(encodeURIComponent)].join("/");
  try {
    const response = await globalThis.fetch(`${apiOrigin()}${path}${new URL(request.url).search}`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)])
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return Response.json(
      { error: { code: "API_UNAVAILABLE", message: "Could not reach the local snapshot API." } },
      { status: 502 }
    );
  }
}
