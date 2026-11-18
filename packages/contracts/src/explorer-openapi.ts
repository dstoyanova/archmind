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

export function createExplorerOpenApiDocument(): ReturnType<
  OpenApiGeneratorV31["generateDocument"]
> {
  extendZodWithOpenApi(z);
  const registry = new OpenAPIRegistry();
  const error = registry.register("ExplorerError", explorerErrorSchema);

  for (const [operationId, suffix, params, query, response] of routes) {
    registry.registerPath({
      method: "get",
      path: `/api/workspaces/{workspaceId}/snapshots${suffix}`,
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
