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

// Two components named "pre", and a package that only has test files.
const sharedComponents: SnapshotBuilderInput["components"] = [
  { id: "root", name: "Repository", kind: "root", depth: 0, paths: ["."] },
  {
    id: "pre-package",
    name: "pre",
    kind: "package",
    depth: 1,
    parentId: "root",
    paths: ["packages/pre"]
  },
  { id: "cli", name: "cli", kind: "package", depth: 1, parentId: "root", paths: ["packages/cli"] },
  {
    id: "fixtures",
    name: "fixtures",
    kind: "package",
    depth: 1,
    parentId: "root",
    paths: ["packages/fixtures"]
  },
  {
    id: "pre-command",
    name: "pre",
    kind: "folder",
    depth: 2,
    parentId: "cli",
    paths: ["packages/cli/src/commands/pre"]
  },
  {
    id: "lib",
    name: "lib",
    kind: "folder",
    depth: 2,
    parentId: "cli",
    paths: ["packages/cli/src/lib"]
  }
];
const sharedFiles: SnapshotBuilderInput["files"] = [
  { path: "packages/pre/src/index.ts", role: "source", loc: 10 },
  { path: "packages/cli/src/main.ts", role: "source", loc: 10 },
  { path: "packages/cli/src/commands/pre/index.ts", role: "source", loc: 10 },
  { path: "packages/cli/src/lib/index.ts", role: "source", loc: 10 },
  { path: "packages/fixtures/index.test.ts", role: "test", loc: 10 }
];
const sharedOwners = ["pre-package", "cli", "pre-command", "lib", "fixtures"];
const sharedImport = (from: number, to: number, line: number) => ({
  filePath: sharedFiles[from]!.path,
  resolvedFilePath: sharedFiles[to]!.path,
  specifier: "./target",
  resolution: "internal-file" as const,
  kind: "static" as const,
  line,
  column: 1
});
await writeFile(
  join(directory, "shared-names.json"),
  JSON.stringify(
    buildArchitectureSnapshot({
      engineVersion: "fixture",
      parserVersion: "fixture",
      analysisConfigHash: "fixture",
      source: { kind: "local", sourceHash: "fixture" },
      components: sharedComponents,
      ownership: sharedFiles.map(({ path }, index) => ({
        filePath: path,
        componentId: sharedOwners[index]!
      })),
      files: sharedFiles,
      fileImports: [
        sharedImport(1, 0, 1),
        sharedImport(2, 0, 2),
        sharedImport(1, 2, 3),
        sharedImport(1, 3, 4)
      ],
      symbols: [],
      diagnostics: [],
      resolutionStats: { countsByResolution: { "internal-file": 4 }, unresolvedRate: 0 }
    })
  )
);
