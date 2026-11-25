import { apiOrigin } from "@/features/explorer/api-origin";

export async function GET(
  request: Request,
  context: { params: Promise<{ segments?: string[] }> }
): Promise<Response> {
  const { segments = [] } = await context.params;
  const [id, resource, finding] = segments;
  const opaque = (value?: string) => /^[a-f0-9]{64}$/.test(value ?? "");
  const evaluations =
    opaque(id) &&
    (segments.length === 1 ||
      (segments.length === 2 && (resource === "findings" || resource === "health")) ||
      (segments.length === 3 && resource === "findings" && opaque(finding)));
  if (!evaluations) {
    return Response.json(
      { error: { code: "NOT_FOUND", message: "Explorer route not found." } },
      { status: 404 }
    );
  }

  const path = ["/api/workspaces/local/evaluations", ...segments.map(encodeURIComponent)].join("/");
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
