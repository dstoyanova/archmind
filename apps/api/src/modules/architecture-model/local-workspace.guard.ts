import { HttpException, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";

@Injectable()
export class LocalWorkspaceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { headers, params } = context.switchToHttp().getRequest<{
      headers: { host?: string };
      params: { workspaceId?: string };
    }>();
    if (params.workspaceId !== "local") {
      throw new HttpException(
        { error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace not found." } },
        404
      );
    }
    // Keep an unrelated hostname from reaching the local API after resolving to loopback.
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(headers.host ?? "")) {
      throw new HttpException(
        { error: { code: "INVALID_HOST", message: "Use a loopback host." } },
        403
      );
    }
    return true;
  }
}
