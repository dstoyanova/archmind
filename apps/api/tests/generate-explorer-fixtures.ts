import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "node:process";
import { fileURLToPath, URL } from "node:url";

import { analyzeRepository } from "@archmind/analysis-pipeline";
import {
  buildArchitectureSnapshot,
  type SnapshotBuilderInput
} from "@archmind/architecture-engine";

const directory = env.ARCHMIND_SNAPSHOT_DIR;
if (!directory) throw new Error("Provide ARCHMIND_SNAPSHOT_DIR.");
await mkdir(directory, { recursive: true });

const { snapshot } = await analyzeRepository({
  repositoryRoot: fileURLToPath(
    new URL("../../cli/fixtures/monorepo-dist-entrypoints/", import.meta.url)
  )
});
await writeFile(join(directory, "fixture.json"), JSON.stringify(snapshot));
await writeFile(join(directory, "invalid.json"), "{");

const leafCount = 299;
const components: SnapshotBuilderInput["components"] = [
  { id: "root", name: "Repository", kind: "root", depth: 0, paths: ["."] }
];
const ownership: SnapshotBuilderInput["ownership"] = [];
const files: SnapshotBuilderInput["files"] = [];
const fileImports: SnapshotBuilderInput["fileImports"] = [];
const file = (index: number) => `modules/component-${index}/index.ts`;
for (let index = 0; index < leafCount; index++) {
  const id = `component-${index}`;
  const nested = index === leafCount - 1;
  components.push({
    id,
    name: id,
    kind: "folder",
    depth: nested ? 2 : 1,
    parentId: nested ? "component-0" : "root",
    paths: [`modules/${id}`]
  });
  files.push({ path: file(index), role: "source", loc: 20 });
  ownership.push({ filePath: file(index), componentId: id });
}
for (let index = 0; index < 3000; index++) {
  const source = index % leafCount;
  const target = (source + 1 + Math.floor(index / leafCount)) % leafCount;
  fileImports.push({
    filePath: file(source),
    resolvedFilePath: file(target),
    specifier: `./component-${target}`,
    resolution: "internal-file",
    kind: "static",
    line: index + 1,
    column: 1
  });
}
const dense = buildArchitectureSnapshot({
  engineVersion: "benchmark",
  parserVersion: "benchmark",
  analysisConfigHash: "benchmark",
  source: { kind: "local", sourceHash: "benchmark" },
  components,
  ownership,
  files,
  fileImports,
  symbols: [],
  diagnostics: [],
  resolutionStats: { countsByResolution: { "internal-file": 3000 }, unresolvedRate: 0 }
});
if (dense.components.length !== 300 || dense.dependencies.length !== 3000) {
  throw new Error("Performance snapshot has an unexpected graph size.");
}
await writeFile(join(directory, "performance.json"), JSON.stringify(dense));
