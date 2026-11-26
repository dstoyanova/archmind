import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31
} from "@asteasolutions/zod-to-openapi";
import { z, type AnyZodObject, type ZodTypeAny } from "zod";

import {
  componentDetailSchema,
  componentFilesPageSchema,
  componentParamsSchema,
  dependencyEvidencePageSchema,
  dependencyEvidenceQuerySchema,
  diagnosticsPageSchema,
  explorerErrorSchema,
  graphQueryParametersSchema,
  graphResponseSchema,
  pageQuerySchema,
  projectionQuerySchema,
  snapshotListSchema,
  snapshotOverviewSchema,
  snapshotParamsSchema,
  workspaceParamsSchema
} from "./explorer-schema.js";
import {
  baselineQuerySchema,
  evaluationDetailSchema,
  evaluationHealthSchema,
  evaluationListSchema,
  findingDetailSchema,
  findingHighlightsSchema,
  findingParamsSchema,
  findingsPageSchema,
  findingsQuerySchema,
  highlightsQuerySchema
} from "./governance-schema.js";

const routes = [
  ["listSnapshots", "", workspaceParamsSchema, pageQuerySchema, snapshotListSchema],
  ["getSnapshot", "/{id}", snapshotParamsSchema, undefined, snapshotOverviewSchema],
  [
    "getDiagnostics",
    "/{id}/diagnostics",
    snapshotParamsSchema,
    pageQuerySchema,
    diagnosticsPageSchema
  ],
  [
    "getGraph",
    "/{id}/graph",
    snapshotParamsSchema,
    graphQueryParametersSchema,
    graphResponseSchema
  ],
  [
    "getComponent",
    "/{id}/components/{componentId}",
    componentParamsSchema,
    projectionQuerySchema,
    componentDetailSchema
  ],
  [
    "getComponentFiles",
    "/{id}/components/{componentId}/files",
    componentParamsSchema,
    pageQuerySchema,
    componentFilesPageSchema
  ],
  [
    "getDependencyEvidence",
    "/{id}/dependencies",
    snapshotParamsSchema,
    dependencyEvidenceQuerySchema,
    dependencyEvidencePageSchema
  ]
] as const satisfies readonly [
  operationId: string,
  suffix: string,
  params: AnyZodObject,
  query: AnyZodObject | undefined,
  response: ZodTypeAny
][];

const governanceRoutes = [
  [
    "listEvaluations",
    "/snapshots/{id}/evaluations",
    snapshotParamsSchema,
    pageQuerySchema,
    evaluationListSchema
  ],
  ["getEvaluation", "/evaluations/{id}", snapshotParamsSchema, undefined, evaluationDetailSchema],
  [
    "listFindings",
    "/evaluations/{id}/findings",
    snapshotParamsSchema,
    findingsQuerySchema,
    findingsPageSchema
  ],
  [
    "getFinding",
    "/evaluations/{id}/findings/{findingId}",
    findingParamsSchema,
    pageQuerySchema,
    findingDetailSchema
  ],
  [
    "getFindingHighlights",
    "/evaluations/{id}/highlights",
    snapshotParamsSchema,
    highlightsQuerySchema,
    findingHighlightsSchema
  ],
  [
    "getEvaluationHealth",
    "/evaluations/{id}/health",
    snapshotParamsSchema,
    baselineQuerySchema,
    evaluationHealthSchema
  ]
] as const;

export function createExplorerOpenApiDocument(): ReturnType<
  OpenApiGeneratorV31["generateDocument"]
> {
  extendZodWithOpenApi(z);
  const registry = new OpenAPIRegistry();
  const error = registry.register("ExplorerError", explorerErrorSchema);

  const snapshotRoutes = routes.map(
    ([operationId, suffix, params, query, response]) =>
      [operationId, `/snapshots${suffix}`, params, query, response] as const
  );
  for (const [operationId, suffix, params, query, response] of [
    ...snapshotRoutes,
    ...governanceRoutes
  ]) {
    registry.registerPath({
      method: "get",
      path: `/api/workspaces/{workspaceId}${suffix}`,
      operationId,
      request: query ? { params, query } : { params },
      responses: {
        200: {
          description: "Explorer response",
          content: {
            "application/json": { schema: registry.register(operationId + "Response", response) }
          }
        },
        400: {
          description: "Invalid request",
          content: { "application/json": { schema: error } }
        },
        404: {
          description: "Resource not found",
          content: { "application/json": { schema: error } }
        },
        ...(operationId === "listSnapshots"
          ? {}
          : {
              422: {
                description: "Snapshot or evaluation failed validation",
                content: { "application/json": { schema: error } }
              }
            }),
        default: {
          description: "Explorer error",
          content: { "application/json": { schema: error } }
        }
      }
    });
  }

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: { title: "ArchMind Explorer API", version: "0.1.0" }
  });
}
