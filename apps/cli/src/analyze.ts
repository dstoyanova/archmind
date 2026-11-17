import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  analyzeRepository,
  type AnalyzeRepositoryInput,
  type AnalyzeRepositoryResult
} from "@archmind/analysis-pipeline";
import type { ArchitectureSnapshotDocument } from "@archmind/contracts";
import { compareStrings } from "@archmind/domain";

export { analyzeRepository };
export type { AnalyzeRepositoryInput, AnalyzeRepositoryResult };

export type AnalyzeOutputFormat = "snapshot" | "summary";

export interface AnalyzeCommandInput {
  repositoryPath: string;
  outputPath: string;
  format: AnalyzeOutputFormat;
  /** Receives non-fatal problems that are not part of the snapshot. */
  onWarning?: ((message: string) => void) | undefined;
}

export async function runAnalyzeCommand(input: AnalyzeCommandInput): Promise<string | null> {
  const repositoryRoot = path.resolve(input.repositoryPath);
  const outputPath = path.resolve(input.outputPath);
  const result = await analyzeRepository({
    repositoryRoot
  });
  for (const warning of result.warnings) {
    input.onWarning?.(warning);
  }

  await ensureDirectoryForFile(outputPath);
  await writeFileAtomically(outputPath, JSON.stringify(result.snapshot, null, 2) + "\n");

  if (input.format === "summary") {
    return formatSnapshotSummary(result.snapshot);
  }

  return null;
}

export function formatSnapshotSummary(snapshot: ArchitectureSnapshotDocument): string {
  const errorCount = snapshot.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error"
  ).length;
  const warningCount = snapshot.diagnostics.length - errorCount;
  const runtimeCycles = snapshot.cycles.filter((cycle) => !cycle.typeOnly).length;
  const typeOnlyCycles = snapshot.cycles.length - runtimeCycles;
  const resolutionEntries = Object.entries(snapshot.resolutionStats.countsByResolution)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([resolution, count]) => `  - ${resolution}: ${count}`)
    .join("\n");

  return [
    `Snapshot written.`,
    `- components: ${snapshot.components.length}`,
    `- dependencies: ${snapshot.dependencies.length}`,
    `- cycles: ${snapshot.cycles.length} (runtime: ${runtimeCycles}, type-only: ${typeOnlyCycles})`,
    `- resolution unresolved rate: ${(snapshot.resolutionStats.unresolvedRate * 100).toFixed(2)}%`,
    `- diagnostics: ${snapshot.diagnostics.length} (errors: ${errorCount}, warnings: ${warningCount})`,
    `- resolution statistics:`,
    resolutionEntries || "  - none"
  ].join("\n");
}

export async function ensureDirectoryForFile(filePath: string): Promise<void> {
  const targetDirectory = path.dirname(filePath);
  await mkdir(targetDirectory, { recursive: true });
}

/** Readers never see a partially written snapshot: the content lands via a same-directory rename. */
async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
