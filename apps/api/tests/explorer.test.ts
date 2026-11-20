import { cp, mkdtemp, open, rm, symlink, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, URL, URLSearchParams } from "node:url";

import { analyzeRepository } from "@archmind/analysis-pipeline";
import {
  componentDetailSchema,
  componentFilesPageSchema,
  componentGraphSchema,
  dependencyEvidencePageSchema,
  diagnosticsPageSchema,
  explorerErrorSchema,
  fileGraphSchema,
  snapshotListSchema,
  snapshotOverviewSchema
} from "@archmind/contracts";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createExplorerApp } from "../src/app.js";
import { FileSnapshotReader } from "../src/modules/architecture-model/file-snapshot-reader.js";

const origin = "http://localhost:3000";
const route = "/api/workspaces/local/snapshots";
let directory: string;
let app: INestApplication | undefined;
let base: string;

function get(
  path: string,
  init?: Parameters<typeof globalThis.fetch>[1]
): ReturnType<typeof globalThis.fetch> {
  return globalThis.fetch(`${base}${path}`, init);
}

async function json(path: string, status = 200): Promise<unknown> {
  const response = await get(path);
  expect(response.status).toBe(status);
  return response.json();
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "archmind-explorer-"));
  const fixture = (name: string) =>
    fileURLToPath(new URL(`../../cli/fixtures/${name}/`, import.meta.url));
  const { snapshot } = await analyzeRepository({
    repositoryRoot: fixture("monorepo-dist-entrypoints")
  });
  const malformedFixture = join(directory, "malformed-fixture");
  await cp(fixture("malformed-files"), malformedFixture, { recursive: true });
  await writeFile(join(malformedFixture, "src/broken.ts"), "export const broken = {\n");
  await writeFile(join(malformedFixture, "src/another-broken.ts"), "export const another = {\n");
  const { snapshot: malformed } = await analyzeRepository({ repositoryRoot: malformedFixture });

  const files = {
    "a.json": snapshot,
    "b.json": snapshot,
    "diagnostics.json": malformed,
    "tampered.json": { ...snapshot, engineVersion: "tampered" },
    "unsupported.json": { ...snapshot, schemaVersion: "999" },
    "invalid-schema.json": { ...snapshot, components: null },
    "invalid-invariants.json": { ...snapshot, files: [] },
    "ignore.evaluation.json": {}
  };
  await Promise.all(
    Object.entries(files).map(([name, value]) =>
      writeFile(join(directory, name), JSON.stringify(value))
    )
  );
  await writeFile(join(directory, "invalid-json.json"), "{");
  await symlink(join(directory, "a.json"), join(directory, "linked.json"), "file");
  const large = await open(join(directory, "oversized.json"), "w");
  try {
    await large.truncate(16 * 1024 * 1024 + 1);
  } finally {
    await large.close();
  }

  app = await createExplorerApp({ snapshotDirectory: directory, webOrigin: origin });
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
}, 20_000);

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});

async function snapshotPath(label: string): Promise<string> {
  const list = snapshotListSchema.parse(await json(route));
  const item = list.items.find((snapshot) => snapshot.label === label);
  if (!item) throw new Error(`Missing fixture ${label}.`);
  return `${route}/${item.id}`;
}

describe("local explorer", () => {
  it("reads each unchanged list entry only once even when the list exceeds the graph cache", async () => {
    const handle = await open(join(directory, "a.json"));
    await handle.close();
    const reads = vi.spyOn(Object.getPrototypeOf(handle) as FileHandle, "read");
    const readsFromStart = () =>
      reads.mock.calls.filter((call: readonly unknown[]) => call[3] === 0).length;
    const changed = join(directory, "invalid-json.json");
    try {
      const first = snapshotListSchema.parse(await json(route));
      expect(first.items.length).toBeGreaterThan(4);
      expect(readsFromStart()).toBe(
        first.items.length - 1 // The oversized file is rejected without a body read.
      );
      reads.mockClear();
      expect(await json(route)).toEqual(first);
      expect(reads).not.toHaveBeenCalled();

      const graphPath = `${await snapshotPath("a.json")}/graph`;
      await json(graphPath);
      reads.mockClear();
      await cp(join(directory, "a.json"), changed);
      const refreshed = snapshotListSchema.parse(await json(route));
      expect(refreshed.items.find(({ label }) => label === "invalid-json.json")).toMatchObject({
        status: "ready"
      });
      expect(readsFromStart()).toBe(1);
      reads.mockClear();
      await json(graphPath);
      expect(reads).not.toHaveBeenCalled();
    } finally {
      reads.mockRestore();
      await writeFile(changed, "{");
    }
  });

  it("paginates the listing, gives equal-content files distinct IDs, and diagnoses invalid files", async () => {
    const first = snapshotListSchema.parse(await json(`${route}?limit=2`));
    const [a, b] = first.items;
    expect(a).toMatchObject({ label: "a.json", status: "ready" });
    expect(b).toMatchObject({ label: "b.json", status: "ready" });
    if (a?.status !== "ready" || b?.status !== "ready" || !first.nextCursor)
      throw new Error("Missing ready fixtures or cursor.");
    expect(a.id).not.toBe(b.id);
    expect(a.contentHash).toBe(b.contentHash);

    const rest = snapshotListSchema.parse(await json(`${route}?cursor=${first.nextCursor}`));
    expect(rest.nextCursor).toBeNull();
    expect(rest.items.map((item) => item.label)).toEqual([
      "diagnostics.json",
      "invalid-invariants.json",
      "invalid-json.json",
      "invalid-schema.json",
      "oversized.json",
      "tampered.json",
      "unsupported.json"
    ]);
    expect(rest.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "invalid-invariants.json",
          status: "invalid",
          reason: expect.stringContaining("references")
        }),
        expect.objectContaining({
          label: "invalid-json.json",
          status: "invalid",
          reason: expect.stringContaining("JSON")
        }),
        expect.objectContaining({
          label: "invalid-schema.json",
          status: "invalid",
          reason: expect.stringContaining("document schema")
        }),
        expect.objectContaining({
          label: "oversized.json",
          status: "invalid",
          reason: expect.stringContaining("16 MiB")
        }),
        expect.objectContaining({
          label: "tampered.json",
          status: "invalid",
          reason: expect.stringContaining("content hash")
        }),
        expect.objectContaining({
          label: "unsupported.json",
          status: "invalid",
          reason: expect.stringContaining("version")
        })
      ])
    );
    const tampered = rest.items.find(({ label }) => label === "tampered.json");
    const error = explorerErrorSchema.parse(await json(`${route}/${tampered?.id}`, 422));
    expect(error.error.code).toBe("INVALID_SNAPSHOT");
  });

  it("serves overview, projected graph, evidence, component detail, file graph and file pages", async () => {
    const path = await snapshotPath("a.json");
    const overview = snapshotOverviewSchema.parse(await json(path));
    expect(overview.fileCount).toBeGreaterThan(0);
    const graph = componentGraphSchema.parse(await json(`${path}/graph`));
    const edge = graph.dependencies[0];
    if (!edge) throw new Error("Missing projected edge.");
    const { fromComponentId, toComponentId } = edge;
    expect(edge).not.toHaveProperty("evidenceImportIds");
    const evidenceQuery = new URLSearchParams({ from: fromComponentId, to: toComponentId });
    const evidence = dependencyEvidencePageSchema.parse(
      await json(`${path}/dependencies?${evidenceQuery}`)
    );
    expect(evidence.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filePath: "packages/app/src/main.ts", role: "source" })
      ])
    );

    const componentPath = `${path}/components/${encodeURIComponent(toComponentId)}`;
    const detail = componentDetailSchema.parse(await json(componentPath));
    expect(detail.inboundDependencies).toContainEqual(edge);
    const fileGraphQuery = new URLSearchParams({ level: "file", componentId: fromComponentId });
    const files = fileGraphSchema.parse(await json(`${path}/graph?${fileGraphQuery}`));
    expect(files.imports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: { kind: "component", componentId: toComponentId } })
      ])
    );
    const firstPage = componentFilesPageSchema.parse(await json(`${componentPath}/files?limit=1`));
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = componentFilesPageSchema.parse(
      await json(`${componentPath}/files?cursor=${firstPage.nextCursor}`)
    );
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
  });

  it("paginates diagnostics and keeps errors scoped to the local workspace", async () => {
    const path = await snapshotPath("diagnostics.json");
    const diagnostics = diagnosticsPageSchema.parse(await json(`${path}/diagnostics?limit=1`));
    expect(diagnostics.items).toHaveLength(1);
    expect(diagnostics.nextCursor).not.toBeNull();
    const remaining = diagnosticsPageSchema.parse(
      await json(`${path}/diagnostics?cursor=${diagnostics.nextCursor}`)
    );
    expect(remaining.items[0]?.filePath).not.toBe(diagnostics.items[0]?.filePath);
    expect(
      explorerErrorSchema.parse(await json(`${path}/diagnostics?cursor=invalid`, 400)).error.code
    ).toBe("INVALID_CURSOR");
    expect(explorerErrorSchema.parse(await json(`${path}/graph?level=file`, 400)).error.code).toBe(
      "INVALID_REQUEST"
    );
    expect(
      explorerErrorSchema.parse(await json("/api/workspaces/other/snapshots?limit=bad", 404)).error
        .code
    ).toBe("WORKSPACE_NOT_FOUND");
    expect(explorerErrorSchema.parse(await json(`${route}/a.json`, 404)).error.code).toBe(
      "SNAPSHOT_NOT_FOUND"
    );
    expect(explorerErrorSchema.parse(await json(`${route}/missing`, 404)).error.code).toBe(
      "SNAPSHOT_NOT_FOUND"
    );
    expect((await get(route, { method: "POST" })).status).toBe(404);
  });

  it("returns a clear validation error above the expansion limit", async () => {
    const path = await snapshotPath("a.json");
    const query = new URLSearchParams();
    for (let index = 0; index < 128; index++) {
      query.append("expand", `cmp:${index.toString(16).padStart(64, "0")}`);
    }
    await json(`${path}/graph?${query}`);
    query.append("expand", `cmp:${"f".repeat(64)}`);
    expect(explorerErrorSchema.parse(await json(`${path}/graph?${query}`, 400))).toEqual({
      error: { code: "INVALID_REQUEST", message: "At most 128 expand values are allowed." }
    });
  });

  it("serves Swagger UI and allows only the configured browser origin", async () => {
    const allowed = await get(route, { headers: { Origin: origin } });
    const blocked = await get(route, { headers: { Origin: "https://other.invalid" } });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(origin);
    expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
    const ui = await get("/api/docs");
    expect(ui.status).toBe(200);
    expect(await ui.text()).toContain("swagger-ui");
    expect(await json("/api/docs/openapi.json")).toMatchObject({
      openapi: "3.1.0",
      paths: { "/api/workspaces/{workspaceId}/snapshots/{id}/graph": expect.any(Object) }
    });
  });

  it("reuses the indexed snapshot until the underlying file changes", async () => {
    const reader = new FileSnapshotReader(directory);
    const identity = (await reader.list()).find(({ label }) => label === "b.json");
    if (!identity) throw new Error("Missing file reader fixture.");
    const [first, concurrent] = await Promise.all([reader.load(identity), reader.load(identity)]);
    expect(first.status).toBe("ready");
    expect(first).toBe(concurrent);
    expect(await reader.load(identity)).toBe(first);
    await writeFile(join(directory, identity.label), "{");
    expect(await reader.load(identity)).toEqual({
      status: "invalid",
      reason: "Snapshot is not valid JSON."
    });
  });
});
