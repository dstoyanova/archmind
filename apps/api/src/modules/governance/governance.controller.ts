import {
  baselineQuerySchema,
  findingParamsSchema,
  findingsQuerySchema,
  pageQuerySchema,
  snapshotParamsSchema,
  type FindingsQuery,
  type PageQuery
} from "@archmind/contracts";
import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { createZodDto, ZodValidationPipe } from "nestjs-zod";

import { LocalWorkspaceGuard } from "../architecture-model/local-workspace.guard.js";
import { GovernanceService } from "./governance.service.js";

const params = new ZodValidationPipe(createZodDto(snapshotParamsSchema));
const findingParams = new ZodValidationPipe(createZodDto(findingParamsSchema));
const page = new ZodValidationPipe(createZodDto(pageQuerySchema));
const findings = new ZodValidationPipe(createZodDto(findingsQuerySchema));
const baseline = new ZodValidationPipe(createZodDto(baselineQuerySchema));

@Controller("api/workspaces/:workspaceId")
@UseGuards(LocalWorkspaceGuard)
export class GovernanceController {
  constructor(@Inject(GovernanceService) private readonly service: GovernanceService) {}

  @Get("snapshots/:id/evaluations")
  list(
    @Param(params) { id }: { id: string },
    @Query(page) query: PageQuery
  ): ReturnType<GovernanceService["list"]> {
    return this.service.list(id, query);
  }

  @Get("evaluations/:id")
  detail(@Param(params) { id }: { id: string }): ReturnType<GovernanceService["detail"]> {
    return this.service.detail(id);
  }

  @Get("evaluations/:id/findings")
  findings(
    @Param(params) { id }: { id: string },
    @Query(findings) query: FindingsQuery
  ): ReturnType<GovernanceService["findings"]> {
    return this.service.findings(id, query);
  }

  @Get("evaluations/:id/findings/:findingId")
  finding(
    @Param(findingParams) { id, findingId }: { id: string; findingId: string },
    @Query(page) query: PageQuery
  ): ReturnType<GovernanceService["finding"]> {
    return this.service.finding(id, findingId, query);
  }

  @Get("evaluations/:id/health")
  health(
    @Param(params) { id }: { id: string },
    @Query(baseline) query: { baseline?: string }
  ): ReturnType<GovernanceService["health"]> {
    return this.service.health(id, query.baseline);
  }
}
