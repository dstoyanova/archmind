import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeRepository, formatSnapshotSummary, runAnalyzeCommand } from "./analyze.js";
import { runCli } from "./main.js";

function fixturePath(name: string): string {
  return path.join(import.meta.dirname, "..", "fixtures", name);
}

describe("analyzeRepository", () => {
  it("writes a snapshot and prints summary output for the analyze CLI command", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "archmind-cli-"));
    const outputPath = path.join(tempDir, "snapshots", "snapshot.json");

    try {
      const summary = await runAnalyzeCommand({
        repositoryPath: fixturePath("single-package"),
        outputPath,
        format: "summary"
      });

      expect(summary).toContain("components:");
      expect(summary).toContain("dependencies:");
      expect(summary).toContain("cycles:");
      expect(summary).toContain("resolution statistics:");
      expect(summary).toContain("diagnostics:");

      const snapshot = JSON.parse(await readFile(outputPath, "utf8")) as {
        schemaVersion: string;
      };
      expect(snapshot.schemaVersion).toBe("1");
      expect(await readdir(path.dirname(outputPath))).toEqual(["snapshot.json"]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("covers the monorepo dist entry-point fixture", async () => {
    const snapshot = (
      await analyzeRepository({
        repositoryRoot: fixturePath("monorepo-dist-entrypoints")
      })
    ).snapshot;
    const filePathById = new Map(snapshot.files.map((file) => [file.id, file.path] as const));
    const toResolvedPath = (toFileId?: string) =>
      toFileId ? filePathById.get(toFileId) : undefined;

    expect(
      snapshot.fileImports.filter((fileImport) => fileImport.resolution === "workspace-package")
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          specifier: "@workspace/lib"
        }),
        expect.objectContaining({
          specifier: "@workspace/lib/internal/feature"
        })
      ])
    );
    const rootImport = snapshot.fileImports.find(
      (fileImport) => fileImport.specifier === "@workspace/lib"
    );
    const subpathImport = snapshot.fileImports.find(
      (fileImport) => fileImport.specifier === "@workspace/lib/internal/feature"
    );
    expect(toResolvedPath(rootImport?.toFileId)).toBe("packages/lib/src/index.ts");
    expect(toResolvedPath(subpathImport?.toFileId)).toBe("packages/lib/src/internal/feature.ts");
  });

  it("covers the path-alias fixture", async () => {
    const snapshot = (
      await analyzeRepository({
        repositoryRoot: fixturePath("path-aliases")
      })
    ).snapshot;
    const filePathById = new Map(snapshot.files.map((file) => [file.id, file.path] as const));
    const aliasImport = snapshot.fileImports.find(
      (fileImport) => fileImport.specifier === "@app/util"
    );

    expect(aliasImport?.resolution).toBe("internal-file");
    expect(aliasImport?.toFileId).toBeDefined();
    expect(filePathById.get(aliasImport?.toFileId ?? "")).toBe("src/util.ts");
  });

  it("covers the missing tsconfig extends base fixture", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "archmind-missing-extends-"));
    try {
      const fixtureCopyPath = path.join(tempDir, "missing-extends-base");
      await cp(fixturePath("missing-extends-base"), fixtureCopyPath, {
        recursive: true
      });

      await writeFile(
        path.join(fixtureCopyPath, "tsconfig.json"),
        JSON.stringify(
          {
            extends: "@tsconfig/node20/tsconfig.json",
            compilerOptions: {
              module: "NodeNext",
              moduleResolution: "NodeNext"
            },
            include: ["src/**/*.ts"]
          },
          null,
          2
        ),
        "utf8"
      );

      const snapshot = (
        await analyzeRepository({
          repositoryRoot: fixtureCopyPath
        })
      ).snapshot;

      expect(snapshot.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "TSCONFIG_EXTENDS_UNRESOLVED_PACKAGE_SKIPPED",
            filePath: "tsconfig.json"
          })
        ])
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("covers runtime, type-only and test-only cycle behavior", async () => {
    const snapshot = (
      await analyzeRepository({
        repositoryRoot: fixturePath("cycles")
      })
    ).snapshot;
    const fileIdsByPath = new Map(snapshot.files.map((file) => [file.path, file.id] as const));
    const runtimeCycleMembers = [
      fileIdsByPath.get("src/runtime-a.ts"),
      fileIdsByPath.get("src/runtime-b.ts")
    ];
    const typeOnlyCycleMembers = [
      fileIdsByPath.get("src/type-a.ts"),
      fileIdsByPath.get("src/type-b.ts")
    ];
    const testCycleMembers = [
      fileIdsByPath.get("tests/test-a.ts"),
      fileIdsByPath.get("tests/test-b.ts")
    ];

    expect(
      snapshot.cycles.some(
        (cycle) =>
          cycle.level.kind === "file" &&
          cycle.typeOnly === false &&
          runtimeCycleMembers.every((memberId) => memberId && cycle.memberIds.includes(memberId))
      )
    ).toBe(true);

    expect(
      snapshot.cycles.some(
        (cycle) =>
          cycle.level.kind === "file" &&
          cycle.typeOnly === true &&
          typeOnlyCycleMembers.every((memberId) => memberId && cycle.memberIds.includes(memberId))
      )
    ).toBe(true);

    expect(
      snapshot.cycles.some(
        (cycle) =>
          cycle.level.kind === "file" &&
          testCycleMembers.some((memberId) => memberId && cycle.memberIds.includes(memberId))
      )
    ).toBe(false);
  });

  it("covers malformed files with diagnostics instead of crashing", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "archmind-malformed-"));
    try {
      const malformedFixturePath = path.join(tempDir, "malformed-files");
      await cp(fixturePath("malformed-files"), malformedFixturePath, { recursive: true });
      await writeFile(
        path.join(malformedFixturePath, "src/broken.ts"),
        "export const broken = {\n",
        "utf8"
      );

      const snapshot = (
        await analyzeRepository({
          repositoryRoot: malformedFixturePath
        })
      ).snapshot;

      expect(snapshot.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "SOURCE_FILE_PARSE_ERROR",
            filePath: "src/broken.ts"
          })
        ])
      );

      expect(snapshot.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "src/broken.ts",
            parseStatus: "parse-error"
          })
        ])
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("analyzeRepository reproducibility", () => {
  async function analyzeInTempCopy(fixtureName: string, prefix: string) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));
    try {
      const copyPath = path.join(tempDir, "repo");
      await cp(fixturePath(fixtureName), copyPath, { recursive: true });
      return (await analyzeRepository({ repositoryRoot: copyPath })).snapshot;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  it("produces the same contentHash when the same directory is analysed twice", async () => {
    const first = (await analyzeRepository({ repositoryRoot: fixturePath("single-package") }))
      .snapshot;
    const second = (await analyzeRepository({ repositoryRoot: fixturePath("single-package") }))
      .snapshot;

    expect(second.contentHash).toBe(first.contentHash);
  });

  it("produces the same contentHash for a copy in a different directory", async () => {
    const original = (await analyzeRepository({ repositoryRoot: fixturePath("single-package") }))
      .snapshot;
    const copy = await analyzeInTempCopy("single-package", "archmind-repro-a-");

    expect(copy.contentHash).toBe(original.contentHash);
  });

  it("keeps diagnostics repo-relative so hashes match across directories", async () => {
    const withMissingExtends = async (prefix: string) => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));
      try {
        const copyPath = path.join(tempDir, "repo");
        await cp(fixturePath("single-package"), copyPath, { recursive: true });
        await writeFile(
          path.join(copyPath, "tsconfig.json"),
          JSON.stringify({ extends: "./missing-base.json", include: ["src"] })
        );
        return (await analyzeRepository({ repositoryRoot: copyPath })).snapshot;
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    };

    const first = await withMissingExtends("archmind-repro-b-");
    const second = await withMissingExtends("archmind-repro-c-");

    expect(first.diagnostics).toEqual([
      expect.objectContaining({
        code: "TSCONFIG_PARSE_ERROR",
        message: "Cannot read file 'missing-base.json'.",
        filePath: "tsconfig.json"
      })
    ]);
    expect(second.contentHash).toBe(first.contentHash);
  });
});

describe("runCli", () => {
  it("returns non-zero for unknown commands", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await runCli(["unknown"], {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    });

    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("Usage:");
  });

  it("builds summary text from snapshots", async () => {
    const snapshot = (
      await analyzeRepository({
        repositoryRoot: fixturePath("single-package")
      })
    ).snapshot;

    const summary = formatSnapshotSummary(snapshot);
    expect(summary).toContain("components:");
    expect(summary).toContain("resolution unresolved rate:");
  });
});
