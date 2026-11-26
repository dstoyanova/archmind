import { mkdtemp, open, rm, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { FileEvaluationReader } from "../src/modules/governance/file-evaluation-reader.js";

const evaluation = (findings: unknown[] = []) =>
  JSON.stringify({
    schemaVersion: "1",
    governanceEngineVersion: "0.2.0",
    rulesHash: "a".repeat(64),
    contentHash: "b".repeat(64),
    analysisConfigHash: "c".repeat(64),
    createdAt: "2026-11-26T12:00:00.000Z",
    findings,
    diagnostics: []
  });
let directory: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "archmind-evaluation-reader-"));
  for (let index = 0; index < 10; index++) {
    await writeFile(join(directory, `file-${index}.evaluation.json`), evaluation());
  }
  await writeFile(join(directory, "broken.evaluation.json"), "{");
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("FileEvaluationReader", () => {
  it("summarizes more files than the document cache holds by reading each unchanged file once", async () => {
    const reader = new FileEvaluationReader(directory);
    const identities = await reader.list();
    expect(identities).toHaveLength(11);
    const probe = await open(join(directory, "broken.evaluation.json"));
    await probe.close();
    const reads = vi.spyOn(Object.getPrototypeOf(probe) as FileHandle, "read");
    try {
      const first = await Promise.all(identities.map((identity) => reader.summarize(identity)));
      expect(first.filter(({ status }) => status === "ready")).toHaveLength(10);
      expect(first.filter(({ status }) => status === "invalid")).toEqual([
        { status: "invalid", reason: "Evaluation is not valid JSON." }
      ]);
      const initialReads = reads.mock.calls.length;
      expect(initialReads).toBeGreaterThanOrEqual(11);

      for (const identity of identities) await reader.summarize(identity);
      expect(reads).toHaveBeenCalledTimes(initialReads);

      const [changed] = identities;
      if (!changed) throw new Error("Missing identity.");
      await writeFile(join(directory, changed.label), evaluation([]) + "\n");
      await reader.summarize(changed);
      expect(reads.mock.calls.length).toBeGreaterThan(initialReads);
    } finally {
      reads.mockRestore();
    }
  });
});
