import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  symlink,
  writeFile,
  type FileHandle
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  evaluationDetailSchema,
  evaluationHealthSchema,
  evaluationListSchema,
  findingDetailSchema,
  findingHighlightsSchema,
  findingsPageSchema,
  ruleEvaluationSchema,
  snapshotListSchema
} from "@archmind/contracts";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createExplorerApp } from "../src/app.js";

const workspace = "/api/workspaces/local";
const run = promisify(execFile);
let directory: string;
let documents: string;
let app: INestApplication | undefined;
let base: string;

async function json(path: string, status = 200): Promise<unknown> {
  const response = await globalThis.fetch(`${base}${path}`);
  expect(response.status).toBe(status);
  return response.json();
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "archmind-governance-api-"));
  const repo = join(directory, "repo");
  documents = join(directory, "documents");
  await mkdir(documents);
  await cp(join(import.meta.dirname, "../../cli/fixtures/governance"), repo, { recursive: true });
  const tsx = createRequire(import.meta.url).resolve("tsx/cli");
  const main = join(import.meta.dirname, "../../cli/src/main.ts");
  async function check(label: string) {
    const cwd = join(directory, label);
    await mkdir(cwd);
    const output = join(documents, `${label}-policy.evaluation.json`);
    await expect(
      run(process.execPath, [tsx, main, "check", repo, "--out", output], { cwd })
    ).rejects.toMatchObject({ code: 1 });
    await cp(join(cwd, "archmind.snapshot.json"), join(documents, `${label}.json`));
    return ruleEvaluationSchema.parse(JSON.parse(await readFile(output, "utf8")));
  }
  const baseline = await check("base");
  await writeFile(join(repo, "src/data/index.ts"), 'export const data = "data";\n');
  await writeFile(join(repo, "src/shared/index.ts"), 'import "../ui/index.js";\n');
  await check("head");
  await cp(join(documents, "head.json"), join(documents, "another-snapshot.json"));
  const invalid = {
    orphan: { ...baseline, contentHash: "0".repeat(64) },
    unsupported: { ...baseline, schemaVersion: "999" },
    "unknown-component": {
      ...baseline,
      findings: baseline.findings.map((finding) => ({
        ...finding,
        subject: { kind: "components", componentIds: ["cmp:unknown"] }
      }))
    },
    "unknown-file": {
      ...baseline,
      findings: baseline.findings.map((finding) => ({
        ...finding,
        evidence: finding.evidence.map((item) => ({ ...item, filePath: "src/ghost.ts" }))
      }))
    },
    "invalid-schema": { ...baseline, findings: null }
  };
  for (const [label, document] of Object.entries(invalid)) {
    await writeFile(join(documents, `${label}.evaluation.json`), JSON.stringify(document));
  }
  await writeFile(
    join(documents, "z-older-engine.evaluation.json"),
    JSON.stringify({ ...baseline, governanceEngineVersion: "0.0.1" })
  );
  await writeFile(join(documents, "invalid-json.evaluation.json"), "{");
  await symlink(
    join(documents, "base-policy.evaluation.json"),
    join(documents, "symlink.evaluation.json")
  );
  const oversized = await open(join(documents, "large.evaluation.json"), "w");
  try {
    await oversized.truncate(16 * 1024 * 1024 + 1);
  } finally {
    await oversized.close();
  }

  app = await createExplorerApp({ snapshotDirectory: documents });
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

async function list(label: string) {
  const { items } = snapshotListSchema.parse(await json(`${workspace}/snapshots`));
  const snapshot = items.find((item) => item.label === label);
  if (!snapshot) throw new Error(`Missing snapshot ${label}.`);
  return evaluationListSchema.parse(
    await json(`${workspace}/snapshots/${snapshot.id}/evaluations`)
  );
}

describe("local governance explorer", () => {
  it("links by content hash, reports invalid files with reasons, and resolves only listed IDs", async () => {
    const head = await list("head.json");
    expect(await list("another-snapshot.json")).toEqual(head);
    const [item] = head.items;
    expect(head.items).toMatchObject([{ label: "head-policy.evaluation.json" }]);
    if (!item) throw new Error("Missing evaluation.");
    expect(item.id).not.toBe(item.label);
    expect(head.issues.map(({ label, reason }) => [label, reason])).toEqual([
      ["invalid-json.evaluation.json", expect.stringContaining("JSON")],
      ["invalid-schema.evaluation.json", expect.stringContaining("schema")],
      ["large.evaluation.json", expect.stringContaining("16 MiB")],
      ["orphan.evaluation.json", expect.stringContaining("content hash")],
      ["symlink.evaluation.json", expect.stringContaining("symbolic link")],
      ["unsupported.evaluation.json", expect.stringContaining("schema version")]
    ]);
    for (const { id, reason } of head.issues) {
      expect(await json(`${workspace}/evaluations/${id}`, 422)).toMatchObject({
        error: { code: "INVALID_EVALUATION", message: reason }
      });
    }
    expect(
      evaluationDetailSchema.parse(await json(`${workspace}/evaluations/${item.id}`))
    ).toMatchObject({ ...item, findingCount: 3, diagnostics: [] });
    await json(`${workspace}/evaluations/${item.label}`, 404);
    await json(`/api/workspaces/other/evaluations/${item.id}`, 404);
  });

  it("computes baseline status, scopes cursors, and reads resolved evidence from the baseline", async () => {
    const [head] = (await list("head.json")).items;
    const [baseline] = (await list("base.json")).items;
    if (!head || !baseline) throw new Error("Missing evaluations.");
    const route = `${workspace}/evaluations/${head.id}`;
    const query = `baseline=${baseline.id}`;
    const first = findingsPageSchema.parse(
      await json(`${route}/findings?${query}&status=resolved&limit=1`)
    );
    expect(first.comparison).toEqual({
      rulesChanged: false,
      hierarchyChanged: false,
      engineChanged: false,
      unrelatedBaseline: false
    });
    expect(first.items).toMatchObject([{ status: "resolved", evaluationId: baseline.id }]);
    expect(first.nextCursor).not.toBeNull();
    const rest = findingsPageSchema.parse(
      await json(`${route}/findings?${query}&status=resolved&cursor=${first.nextCursor}`)
    );
    expect(rest.items).toHaveLength(3);
    await json(`${route}/findings?${query}&status=new&cursor=${first.nextCursor}`, 400);
    await json(`${route}/findings?status=resolved`, 400);
    const layers = findingsPageSchema.parse(
      await json(`${route}/findings?${query}&severity=error&ruleId=layers`)
    );
    expect(layers.items).toMatchObject([
      { ruleId: "layers", status: "new", severity: "error", evaluationId: head.id }
    ]);

    const cycle = [...first.items, ...rest.items].find(
      (item) => item.ruleId === "archmind/no-cycles"
    );
    if (!cycle) throw new Error("Missing resolved cycle.");
    const cycleRoute = `${workspace}/evaluations/${cycle.evaluationId}/findings/${cycle.id}`;
    const detail = findingDetailSchema.parse(await json(`${cycleRoute}?limit=1`));
    expect(detail.evidenceTotal).toBe(2);
    expect(detail.evidence.items).toHaveLength(1);
    expect(detail.evidence.nextCursor).not.toBeNull();
    const second = findingDetailSchema.parse(
      await json(`${cycleRoute}?cursor=${detail.evidence.nextCursor}`)
    );
    expect(second.evidence.items).toHaveLength(1);
    expect(second.evidence.items[0]?.filePath).not.toBe(detail.evidence.items[0]?.filePath);
    expect(second.evidence.nextCursor).toBeNull();

    expect(evaluationHealthSchema.parse(await json(`${route}/health?${query}`))).toMatchObject({
      bySeverity: { error: 1, warning: 2 },
      topComponents: [
        { paths: ["src/ui"], count: 3 },
        { paths: ["src/shared"], count: 1 }
      ],
      coverage: { unresolvedRate: 0, diagnosticTotal: 0, diagnosticsByCode: {} },
      comparison: { newCount: 1, resolvedCount: 4 }
    });
  });

  it("accepts evaluations from another engine version and flags the comparison", async () => {
    const [head] = (await list("head.json")).items;
    const older = (await list("base.json")).items.find(({ label }) => label.startsWith("z-older"));
    if (!head || !older) throw new Error("Missing evaluations.");
    expect(older).toMatchObject({ governanceEngineVersion: "0.0.1", findingCount: 6 });
    const route = `${workspace}/evaluations/${head.id}`;
    const page = findingsPageSchema.parse(await json(`${route}/findings?baseline=${older.id}`));
    expect(page.comparison).toMatchObject({ engineChanged: true, unrelatedBaseline: false });
    const health = evaluationHealthSchema.parse(await json(`${route}/health?baseline=${older.id}`));
    expect(health.comparison).toMatchObject({ engineChanged: true, newCount: 1, resolvedCount: 4 });
  });

  it("reports evaluations that do not fit their snapshot as invalid, with a reason", async () => {
    const { items, issues } = await list("base.json");
    expect(items.map(({ label }) => label)).not.toContain("unknown-component.evaluation.json");
    expect(issues.map(({ label, reason }) => [label, reason])).toEqual(
      expect.arrayContaining([
        ["unknown-component.evaluation.json", expect.stringContaining("component")],
        ["unknown-file.evaluation.json", expect.stringContaining("file")]
      ])
    );
    for (const { id, reason } of issues.filter(({ label }) => label.startsWith("unknown-"))) {
      expect(await json(`${workspace}/evaluations/${id}`, 422)).toMatchObject({
        error: { code: "INVALID_EVALUATION", message: reason }
      });
    }
  });

  it("returns filtered highlights without resolved findings", async () => {
    const [head] = (await list("head.json")).items;
    const [baseline] = (await list("base.json")).items;
    if (!head || !baseline) throw new Error("Missing evaluations.");
    const route = `${workspace}/evaluations/${head.id}/highlights`;
    const all = findingHighlightsSchema.parse(await json(route));
    expect(all.total).toBe(head.findingCount);
    expect(all.items).toHaveLength(head.findingCount);
    expect(all.items.every(({ componentIds }) => componentIds.length > 0)).toBe(true);
    const errors = findingHighlightsSchema.parse(await json(`${route}?severity=error`));
    expect(errors.items.map(({ severity }) => severity)).toEqual(["error"]);
    const created = findingHighlightsSchema.parse(
      await json(`${route}?baseline=${baseline.id}&status=new`)
    );
    expect(created.items).toHaveLength(1);
    const resolved = findingHighlightsSchema.parse(
      await json(`${route}?baseline=${baseline.id}&status=resolved`)
    );
    expect(resolved).toEqual({ total: 4, items: [] });
    await json(`${route}?status=new`, 400);
    await json(`${route}?limit=1`, 400);
  });

  it("caches a file by fingerprint and reloads a replacement under the same opaque ID", async () => {
    const [head] = (await list("head.json")).items;
    if (!head) throw new Error("Missing evaluation.");
    const path = join(documents, head.label);
    const text = await readFile(path, "utf8");
    const handle = await open(path);
    await handle.close();
    const reads = vi.spyOn(Object.getPrototypeOf(handle) as FileHandle, "read");
    const route = `${workspace}/evaluations/${head.id}`;
    try {
      await json(route);
      reads.mockClear();
      await json(route);
      expect(reads).not.toHaveBeenCalled();
      await writeFile(path, "{");
      await json(route, 422);
      expect(reads).toHaveBeenCalled();
    } finally {
      reads.mockRestore();
      await writeFile(path, text);
    }
    await json(route);
  });
});
