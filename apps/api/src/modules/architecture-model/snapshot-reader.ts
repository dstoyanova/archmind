import type {
  ArchitectureSnapshotDocument,
  SnapshotIdentity,
  SnapshotListItem
} from "@archmind/contracts";
import type { ArchitectureFile, FileImport, SnapshotProjector } from "@archmind/domain";

export const SNAPSHOT_READER = Symbol("SnapshotReader");

export interface LoadedSnapshot {
  snapshot: ArchitectureSnapshotDocument;
  projector: SnapshotProjector;
  importsById: ReadonlyMap<string, FileImport>;
  filesById: ReadonlyMap<string, ArchitectureFile>;
}

export type SnapshotLoadResult =
  { status: "ready"; data: LoadedSnapshot } | { status: "invalid"; reason: string };

export interface SnapshotReader {
  list(): Promise<readonly SnapshotIdentity[]>;
  summarize(identity: SnapshotIdentity): Promise<SnapshotListItem>;
  load(identity: SnapshotIdentity): Promise<SnapshotLoadResult>;
}
