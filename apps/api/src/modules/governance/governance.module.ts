import { Module, type DynamicModule } from "@nestjs/common";

import { EVALUATION_READER, FileEvaluationReader } from "./file-evaluation-reader.js";
import { GovernanceController } from "./governance.controller.js";
import { GovernanceService } from "./governance.service.js";

@Module({ controllers: [GovernanceController], providers: [GovernanceService] })
export class GovernanceModule {
  static register(snapshotDirectory: string, architectureModel: DynamicModule): DynamicModule {
    return {
      module: GovernanceModule,
      imports: [architectureModel],
      providers: [
        {
          provide: EVALUATION_READER,
          useFactory: () => new FileEvaluationReader(snapshotDirectory)
        }
      ]
    };
  }
}
