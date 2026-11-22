import "reflect-metadata";

import { createExplorerOpenApiDocument } from "@archmind/contracts/explorer-openapi";
import { Module, type INestApplication } from "@nestjs/common";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import { SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";

import { ExplorerErrorFilter } from "./explorer-error.filter.js";
import { ArchitectureModelModule } from "./modules/architecture-model/architecture-model.module.js";

@Module({})
class AppModule {}

export async function createExplorerApp(options: {
  snapshotDirectory: string;
  webOrigin?: string;
}): Promise<INestApplication> {
  const app = await NestFactory.create(
    {
      module: AppModule,
      imports: [ArchitectureModelModule.register(options.snapshotDirectory)]
    },
    { abortOnError: false }
  );

  app.useGlobalFilters(new ExplorerErrorFilter(app.get(HttpAdapterHost)));
  if (options.webOrigin !== undefined) {
    app.enableCors({ origin: [options.webOrigin], methods: ["GET", "HEAD"] });
  }
  // Nest's document type describes OpenAPI 3.0, but setup only serializes the 3.1 document.
  SwaggerModule.setup("api/docs", app, createExplorerOpenApiDocument() as OpenAPIObject, {
    jsonDocumentUrl: "/api/docs/openapi.json"
  });
  return app;
}
