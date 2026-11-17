import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { formatBenchmarkReport, runResolutionBenchmark } from "./resolution-benchmark.js";

function fixturePath(name: string): string {
  return path.join(import.meta.dirname, "..", "fixtures", name);
}

describe("runResolutionBenchmark", () => {
  it("compares analyzed edges with reference edges and writes a report", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "archmind-benchmark-"));
    const referenceEdgesPath = path.join(tempDir, "reference.json");
    const outputPath = path.join(tempDir, "report.md");

    try {
      await writeFile(
        referenceEdgesPath,
        JSON.stringify([{ from: "src/index.ts", to: "src/util.ts" }], null, 2)
      );

      const results = await runResolutionBenchmark({
        repositories: [
          {
            name: "single-package",
            repositoryPath: fixturePath("single-package"),
            referenceEdgesPath
          }
        ],
        outputPath
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.agreement).toBe(1);
      expect(results[0]?.unresolvedTargetMet).toBe(true);
      expect(results[0]?.agreementTargetMet).toBe(true);

      const report = await readFile(outputPath, "utf8");
      expect(report).toContain("| single-package |");
      expect(report).toContain("100.00%");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("formats benchmark results as markdown", () => {
    const report = formatBenchmarkReport([
      {
        repository: "repo-1",
        files: 5001,
        durationMs: 119_999,
        unresolvedRate: 0.01,
        agreement: 0.96,
        unresolvedTargetMet: true,
        agreementTargetMet: true,
        performanceTargetMet: true
      }
    ]);

    expect(report).toContain("# M1 Resolution Benchmark");
    expect(report).toContain("| repo-1 | 5001 |");
  });
});
