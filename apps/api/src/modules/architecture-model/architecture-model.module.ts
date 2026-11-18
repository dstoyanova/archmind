import { Module, type DynamicModule } from "@nestjs/common";

import { ExplorerController } from "./explorer.controller.js";
import { ExplorerService } from "./explorer.service.js";
import { FileSnapshotReader } from "./file-snapshot-reader.js";
import { LocalWorkspaceGuard } from "./local-workspace.guard.js";
import { SNAPSHOT_READER } from "./snapshot-reader.js";

@Module({
  controllers: [ExplorerController],
  providers: [ExplorerService, LocalWorkspaceGuard]
})
export class ArchitectureModelModule {
  static register(snapshotDirectory: string): DynamicModule {
    return {
      module: ArchitectureModelModule,
      providers: [
        { provide: SNAPSHOT_READER, useFactory: () => new FileSnapshotReader(snapshotDirectory) }
      ]
    };
  }
}
