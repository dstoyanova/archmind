import {
  explorerErrorSchema,
  MAX_PROJECTION_EXPANSIONS,
  PROJECTION_EXPANSION_LIMIT_MESSAGE,
  type ExplorerError
} from "@archmind/contracts";
import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { ZodValidationException } from "nestjs-zod";
import { ZodError } from "zod";

@Catch()
export class ExplorerErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ExplorerErrorFilter.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const body = this.errorBody(exception, status);
    this.adapterHost.httpAdapter.reply(host.switchToHttp().getResponse(), body, status);
  }

  private errorBody(exception: unknown, status: number): ExplorerError {
    if (status >= 500) {
      this.logger.error("Explorer request failed unexpectedly.");
      return { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } };
    }

    if (exception instanceof ZodValidationException) {
      const error = exception.getZodError();
      const exceedsExpansionLimit =
        error instanceof ZodError &&
        error.issues.some(
          (issue) =>
            issue.code === "too_big" &&
            issue.type === "array" &&
            issue.maximum === MAX_PROJECTION_EXPANSIONS &&
            issue.path.length === 1 &&
            issue.path[0] === "expand"
        );
      return {
        error: {
          code: "INVALID_REQUEST",
          message: exceedsExpansionLimit
            ? PROJECTION_EXPANSION_LIMIT_MESSAGE
            : "Invalid request parameters."
        }
      };
    }

    if (exception instanceof HttpException) {
      const parsed = explorerErrorSchema.safeParse(exception.getResponse());
      if (parsed.success) return parsed.data;
    }

    return status === 404
      ? { error: { code: "NOT_FOUND", message: "Resource not found." } }
      : { error: { code: "REQUEST_ERROR", message: "The request could not be completed." } };
  }
}
