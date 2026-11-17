import { createHash } from "node:crypto";

import type { ArchitectureSnapshotDocument } from "@archmind/contracts";
import { canonicalJson } from "@archmind/domain";

/**
 * Hash over the analysis result only. `source`, `schemaVersion`, `createdAt` and the
 * hash itself are excluded, so the same code analysed anywhere hashes identically.
 */
export function computeContentHash(snapshot: ArchitectureSnapshotDocument): string {
  const payload = {
    engineVersion: snapshot.engineVersion,
    parserVersion: snapshot.parserVersion,
    analysisConfigHash: snapshot.analysisConfigHash,
    components: snapshot.components,
    files: snapshot.files,
    symbols: snapshot.symbols,
    fileImports: snapshot.fileImports,
    dependencies: snapshot.dependencies,
    externalDependencies: snapshot.externalDependencies,
    cycles: snapshot.cycles,
    diagnostics: snapshot.diagnostics,
    resolutionStats: snapshot.resolutionStats
  };

  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

/** True when `snapshot.contentHash` matches its content, so tampering or corruption is detectable on read. */
export function verifyContentHash(snapshot: ArchitectureSnapshotDocument): boolean {
  return snapshot.contentHash === computeContentHash(snapshot);
}
