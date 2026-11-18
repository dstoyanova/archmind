import {
  componentParamsSchema,
  dependencyEvidenceQuerySchema,
  graphQuerySchema,
  pageQuerySchema,
  projectionQuerySchema,
  snapshotParamsSchema,
  type DependencyEvidenceQuery,
  type GraphQuery,
  type PageQuery,
  type ProjectionQuery
} from "@archmind/contracts";
import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { createZodDto, ZodValidationPipe } from "nestjs-zod";

import { ExplorerService } from "./explorer.service.js";
import { LocalWorkspaceGuard } from "./local-workspace.guard.js";

const snapshotParams = new ZodValidationPipe(createZodDto(snapshotParamsSchema));
const componentParams = new ZodValidationPipe(createZodDto(componentParamsSchema));
const pageQuery = new ZodValidationPipe(createZodDto(pageQuerySchema));
const graphQuery = new ZodValidationPipe(createZodDto(graphQuerySchema));
const projectionQuery = new ZodValidationPipe(createZodDto(projectionQuerySchema));
const evidenceQuery = new ZodValidationPipe(createZodDto(dependencyEvidenceQuerySchema));

@Controller("api/workspaces/:workspaceId/snapshots")
@UseGuards(LocalWorkspaceGuard)
export class ExplorerController {
  constructor(@Inject(ExplorerService) private readonly explorer: ExplorerService) {}

  @Get()
  list(@Query(pageQuery) query: PageQuery): ReturnType<ExplorerService["list"]> {
    return this.explorer.list(query);
  }

  @Get(":id")
  overview(@Param(snapshotParams) { id }: { id: string }): ReturnType<ExplorerService["overview"]> {
    return this.explorer.overview(id);
  }

  @Get(":id/diagnostics")
  diagnostics(
    @Param(snapshotParams) { id }: { id: string },
    @Query(pageQuery) query: PageQuery
  ): ReturnType<ExplorerService["diagnostics"]> {
    return this.explorer.diagnostics(id, query);
  }

  @Get(":id/graph")
  graph(
    @Param(snapshotParams) { id }: { id: string },
    @Query(graphQuery) query: GraphQuery
  ): ReturnType<ExplorerService["graph"]> {
    return this.explorer.graph(id, query);
  }

  @Get(":id/components/:componentId")
  detail(
    @Param(componentParams) { id, componentId }: { id: string; componentId: string },
    @Query(projectionQuery) query: ProjectionQuery
  ): ReturnType<ExplorerService["detail"]> {
    return this.explorer.detail(id, componentId, query);
  }

  @Get(":id/components/:componentId/files")
  files(
    @Param(componentParams) { id, componentId }: { id: string; componentId: string },
    @Query(pageQuery) query: PageQuery
  ): ReturnType<ExplorerService["files"]> {
    return this.explorer.files(id, componentId, query);
  }

  @Get(":id/dependencies")
  evidence(
    @Param(snapshotParams) { id }: { id: string },
    @Query(evidenceQuery) query: DependencyEvidenceQuery
  ): ReturnType<ExplorerService["evidence"]> {
    return this.explorer.evidence(id, query);
  }
}
