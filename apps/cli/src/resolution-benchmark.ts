import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import type { ArchitectureSnapshotDocument } from "@archmind/contracts";

import { analyzeRepository, ensureDirectoryForFile } from "./analyze.js";

export interface ResolutionBenchmarkRepositoryConfig {
  name: string;
  repositoryPath: string;
  referenceEdgesPath: string;
}

export interface ResolutionBenchmarkConfig {
  repositories: ResolutionBenchmarkRepositoryConfig[];
  outputPath: string;
}

export interface ResolutionBenchmarkResult {
  repository: string;
  files: number;
  durationMs: number;
  unresolvedRate: number;
  agreement: number;
  unresolvedTargetMet: boolean;
  agreementTargetMet: boolean;
  performanceTargetMet?: boolean;
}

export async function runResolutionBenchmark(
  config: ResolutionBenchmarkConfig
): Promise<ResolutionBenchmarkResult[]> {
  const results: ResolutionBenchmarkResult[] = [];

  for (const repository of config.repositories) {
    const startedAt = performance.now();
    const snapshot = (
      await analyzeRepository({
        repositoryRoot: repository.repositoryPath
      })
    ).snapshot;
    const durationMs = performance.now() - startedAt;
    const referenceEdges = await loadReferenceEdges(repository.referenceEdgesPath);
    const analyzedEdges = collectInternalFileEdges(snapshot);
    const agreement = computeAgreement(analyzedEdges, referenceEdges);

    const performanceTargetMet =
      snapshot.files.length >= 5000 ? durationMs < 120000 : undefined;

    results.push({
      repository: repository.name,
      files: snapshot.files.length,
      durationMs,
      unresolvedRate: snapshot.resolutionStats.unresolvedRate,
      agreement,
      unresolvedTargetMet: snapshot.resolutionStats.unresolvedRate <= 0.02,
      agreementTargetMet: agreement >= 0.95,
      ...(performanceTargetMet === undefined ? {} : { performanceTargetMet })
    });
  }

  const report = formatBenchmarkReport(results);
  const outputPath = path.resolve(config.outputPath);
  await ensureDirectoryForFile(outputPath);
  await writeFile(outputPath, report, "utf8");

  return results;
}

export function formatBenchmarkReport(results: ResolutionBenchmarkResult[]): string {
  const lines = [
    "# M1 Resolution Benchmark",
    "",
    "Reference: NFR-7 and NFR-8.",
    "",
    "| Repository | Files | Duration (ms) | Unresolved rate | Agreement | Unresolved <= 2% | Agreement >= 95% | NFR-7 (<2 min @ >=5000 files) |",
    "| --- | ---: | ---: | ---: | ---: | :---: | :---: | :---: |"
  ];

  for (const result of results) {
    lines.push(
      `| ${result.repository} | ${result.files} | ${result.durationMs.toFixed(0)} | ${(result.unresolvedRate * 100).toFixed(2)}% | ${(result.agreement * 100).toFixed(2)}% | ${toPassFail(result.unresolvedTargetMet)} | ${toPassFail(result.agreementTargetMet)} | ${toPerfStatus(result.performanceTargetMet)} |`
    );
  }

  return lines.join("\n") + "\n";
}

function toPassFail(value: boolean): string {
  return value ? "✅" : "❌";
}

function toPerfStatus(value: boolean | undefined): string {
  if (value === undefined) {
    return "n/a";
  }

  return value ? "✅" : "❌";
}

async function loadReferenceEdges(referenceEdgesPath: string): Promise<Set<string>> {
  const resolvedPath = path.resolve(referenceEdgesPath);
  const content = await readFile(resolvedPath, "utf8");
  const parsed = JSON.parse(content) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Reference edge file "${resolvedPath}" must be a JSON array of entries.`
    );
  }

  const edges = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry === "string") {
      edges.add(entry);
      continue;
    }

    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { from?: unknown }).from === "string" &&
      typeof (entry as { to?: unknown }).to === "string"
    ) {
      const from = (entry as { from: string }).from;
      const to = (entry as { to: string }).to;
      edges.add(`${from}->${to}`);
      continue;
    }

    throw new Error(
      `Reference edge file "${resolvedPath}" contains an invalid edge entry.`
    );
  }

  return edges;
}

function collectInternalFileEdges(snapshot: ArchitectureSnapshotDocument): Set<string> {
  const filePathById = new Map(snapshot.files.map((file) => [file.id, file.path] as const));
  const edges = new Set<string>();
  for (const fileImport of snapshot.fileImports) {
    if (fileImport.resolution !== "internal-file") {
      continue;
    }

    if (!fileImport.toFileId) {
      continue;
    }

    const fromPath = filePathById.get(fileImport.fromFileId);
    const toPath = filePathById.get(fileImport.toFileId);
    if (!fromPath || !toPath) {
      continue;
    }

    edges.add(`${fromPath}->${toPath}`);
  }

  return edges;
}

function computeAgreement(ours: Set<string>, reference: Set<string>): number {
  const union = new Set<string>([...ours, ...reference]);
  if (union.size === 0) {
    return 1;
  }

  let matches = 0;
  for (const edge of union) {
    if (ours.has(edge) === reference.has(edge)) {
      matches += 1;
    }
  }

  return matches / union.size;
}
