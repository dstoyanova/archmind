import { snapshotPath } from "@/features/explorer/api";
import { apiOrigin } from "@/features/explorer/api-origin";

export async function GET(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> }
): Promise<Response> {
  const { segments = [] } = await context.params;
  const [id, resource, component, suffix] = segments;
  const allowed =
    segments.length === 0 ||
    (/^[a-f0-9]{64}$/.test(id ?? "") &&
      (segments.length === 1 ||
        (segments.length === 2 &&
          ["graph", "diagnostics", "dependencies"].includes(resource ?? "")) ||
        (resource === "components" &&
          component &&
          component !== "." &&
          component !== ".." &&
          (segments.length === 3 || (segments.length === 4 && suffix === "files")))));
  if (!allowed) {
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
