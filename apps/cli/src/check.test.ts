import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { architectureSnapshotSchema, ruleEvaluationSchema } from "@archmind/contracts";
import { describe, expect, it } from "vitest";

import { runCli } from "./main.js";

const fixture = path.join(import.meta.dirname, "../fixtures/governance");
const runProcess = promisify(execFile);

async function invoke(...args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(args, {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line)
  });
  return { code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}

async function withFixture(test: (root: string, repo: string, snapshot: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "archmind-check-"));
  try {
    const repo = path.join(root, "repo");
    const snapshot = path.join(root, "archmind.snapshot.json");
    await cp(fixture, repo, { recursive: true });
    await test(root, repo, snapshot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("archmind check", () => {
  it("writes a snapshot and evaluation, then gates only new findings when requested", async () => {
    await withFixture(async (root, repo, snapshot) => {
      const evaluationPath = `${snapshot}.evaluation.json`;
      await expect(
        runProcess(
          process.execPath,
          [
            createRequire(import.meta.url).resolve("tsx/cli"),
            path.join(import.meta.dirname, "main.ts"),
            "check",
            repo,
            "--format",
            "summary"
          ],
          { cwd: root }
        )
      ).rejects.toMatchObject({
        code: 1,
        stdout: expect.stringContaining("analysis coverage:")
      });

      const current = ruleEvaluationSchema.parse(
        JSON.parse(await readFile(evaluationPath, "utf8"))
      );
      expect(current.findings.map((finding) => finding.ruleId)).toEqual([
        "archmind/no-cycles",
        "cycles",
        "forbid-data-to-ui",
        "layers",
        "max-ui-fan-out",
        "restrict-storage"
      ]);
      const input = architectureSnapshotSchema.parse(JSON.parse(await readFile(snapshot, "utf8")));
      expect(current.contentHash).toBe(input.contentHash);
      expect(input.cycles.some((cycle) => cycle.level.kind === "depth" && cycle.typeOnly)).toBe(
        true
      );
      const defaultCycle = current.findings.find(
        (finding) => finding.ruleId === "archmind/no-cycles"
      );
      expect(defaultCycle?.evidence.map(({ filePath }) => filePath)).toEqual([
        "src/data/index.ts",
        "src/ui/index.ts"
      ]);

      const baseline = path.join(root, "baseline.json");
      await rename(evaluationPath, baseline);
      const same = await invoke(
        "check",
        repo,
        "--snapshot",
        snapshot,
        "--baseline",
        baseline,
        "--new-only",
        "--format",
        "summary"
      );
      expect(same.code).toBe(0);
      expect(same.stdout).toContain("0 new, 6 existing, 0 resolved");

      await writeFile(path.join(repo, "src/data/index.ts"), 'export const data = "data";\n');
      await writeFile(path.join(repo, "src/shared/index.ts"), 'import "../ui/index.js";\n');
      expect((await invoke("analyze", repo, "--out", snapshot)).code).toBe(0);
      const head = await invoke(
        "check",
        repo,
        "--snapshot",
        snapshot,
        "--baseline",
        baseline,
        "--new-only",
        "--format",
        "summary"
      );
      expect(head.code).toBe(1);
      expect(head.stdout).toContain("1 new, 2 existing, 4 resolved");
      expect(head.stdout).toContain("rules changed: no; hierarchy changed: no; engine changed: no");
    });
  });

  it("re-evaluates changed rules against unchanged snapshot bytes and applies severity thresholds", async () => {
    await withFixture(async (root, repo, snapshot) => {
      expect((await invoke("analyze", repo, "--out", snapshot)).code).toBe(0);
      const input = await readFile(snapshot, "utf8");
      const first = await invoke("check", repo, "--snapshot", snapshot);
      expect(first).toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining('3 finding(s) at or above "error" severity')
      });
      const listed = await invoke("check", repo, "--snapshot", snapshot, "--format", "summary");
      expect(listed.code).toBe(1);
      expect(listed.stdout).toContain("- findings that fail the check (");
      expect(listed.stdout).toMatch(
        /\[error\] forbid-data-to-ui: Forbidden dependency from src\/data to src\/ui\. \(src\/data\/index\.ts:\d+:\d+\)/u
      );
      expect(listed.stdout).not.toContain("[warning] max-ui-fan-out");
      const firstEvaluation = ruleEvaluationSchema.parse(
        JSON.parse(await readFile(`${snapshot}.evaluation.json`, "utf8"))
      );
      await rename(path.join(repo, "src"), path.join(root, "moved-src"));
      await writeFile(
        path.join(repo, "archmind.config.json"),
        JSON.stringify({
          rules: {
            disableDefaults: ["archmind/no-cycles"],
            definitions: [
              {
                id: "size",
                type: "threshold",
                severity: "warning",
                components: [{ path: "src/ui" }],
                metric: "fileCount",
                max: 0
              }
            ]
          }
        })
      );

      const changed = await invoke("check", repo, "--snapshot", snapshot);
      expect(changed).toMatchObject({ code: 0, stderr: "" });
      const secondEvaluation = ruleEvaluationSchema.parse(
        JSON.parse(await readFile(`${snapshot}.evaluation.json`, "utf8"))
      );
      expect(secondEvaluation.rulesHash).not.toBe(firstEvaluation.rulesHash);
      expect(secondEvaluation.contentHash).toBe(firstEvaluation.contentHash);
      expect(secondEvaluation.findings).toMatchObject([{ ruleId: "size", severity: "warning" }]);
      expect(
        (await invoke("check", repo, "--snapshot", snapshot, "--fail-on", "warning")).code
      ).toBe(1);
      expect(await readFile(snapshot, "utf8")).toBe(input);

      await writeFile(
        path.join(repo, "archmind.config.json"),
        JSON.stringify({
          analysis: { exclude: ["src/**"] },
          rules: { disableDefaults: ["archmind/no-cycles"] }
        })
      );
      const stale = await invoke("check", repo, "--snapshot", snapshot);
      expect(stale.code).toBe(0);
      expect(stale.stderr).toContain("Current analysis configuration differs from the snapshot");
    });
  });

  it("returns a tool error for unsupported or modified snapshots, bad baselines and invalid rules", async () => {
    await withFixture(async (root, repo, snapshot) => {
      expect((await invoke("analyze", repo, "--out", snapshot)).code).toBe(0);
      const text = await readFile(snapshot, "utf8");
      const original = architectureSnapshotSchema.parse(JSON.parse(text));
      const check = (...options: string[]) =>
        invoke("check", repo, "--snapshot", snapshot, ...options);
      const baseline = path.join(root, "baseline.json");
      await writeFile(baseline, "{}");
      expect(await check("--baseline", baseline)).toMatchObject({
        code: 2,
        stderr: expect.stringContaining("Invalid baseline")
      });
      expect(await check("--new-only")).toMatchObject({
        code: 2,
        stderr: expect.stringContaining("requires --baseline")
      });
      expect(await check("--out", snapshot)).toMatchObject({
        code: 2,
        stderr: expect.stringContaining("must not overwrite")
      });
      expect(await readFile(snapshot, "utf8")).toBe(text);

      await writeFile(snapshot, JSON.stringify({ ...original, schemaVersion: "999" }));
      expect(await check()).toMatchObject({
        code: 2,
        stderr: expect.stringContaining("Unsupported snapshot schema version")
      });
      await writeFile(snapshot, JSON.stringify({ ...original, contentHash: "0".repeat(64) }));
      expect(await check()).toMatchObject({
        code: 2,
        stderr: expect.stringContaining("contentHash does not match")
      });

      await writeFile(snapshot, text);
      await writeFile(
        path.join(repo, "archmind.config.json"),
        JSON.stringify({
          rules: { definitions: [{ id: "bad-rule", type: "no-cycles", severity: "fatal" }] }
        })
      );
      expect(await check()).toMatchObject({
        code: 2,
        stderr: expect.stringContaining('Rule "bad-rule", severity')
      });

      await writeFile(
        path.join(repo, "archmind.config.json"),
        JSON.stringify({
          rules: {
            definitions: [
              {
                id: "missing-component",
                type: "no-cycles",
                severity: "error",
                components: [{ path: "src/missing" }]
              }
            ]
          }
        })
      );
      const output = path.join(root, "results", "evaluation.json");
      expect(await check("--out", output)).toMatchObject({
        code: 2,
        stderr: expect.stringContaining("No component matched")
      });
      expect(
        ruleEvaluationSchema.parse(JSON.parse(await readFile(output, "utf8"))).diagnostics
      ).toMatchObject([{ ruleId: "missing-component", code: "SELECTOR_NO_MATCH" }]);
    });
  });

  it("flags a baseline from another engine version or another project", async () => {
    await withFixture(async (root, repo, snapshot) => {
      expect((await invoke("analyze", repo, "--out", snapshot)).code).toBe(0);
      expect((await invoke("check", repo, "--snapshot", snapshot)).code).toBe(1);
      const evaluation = ruleEvaluationSchema.parse(
        JSON.parse(await readFile(`${snapshot}.evaluation.json`, "utf8"))
      );
      const baseline = path.join(root, "baseline.json");
      await writeFile(
        baseline,
        JSON.stringify({ ...evaluation, governanceEngineVersion: "0.0.1" })
      );
      const older = await invoke(
        "check",
        repo,
        "--snapshot",
        snapshot,
        "--baseline",
        baseline,
        "--format",
        "summary"
      );
      expect(older.stdout).toContain("engine changed: yes");
      expect(older.stderr).not.toContain("share no component");

      const foreign = evaluation.findings.map((finding) => ({
        ...finding,
        fingerprint: "f".repeat(64),
        subject: { kind: "components", componentIds: ["cmp:elsewhere"] }
      }));
      await writeFile(baseline, JSON.stringify({ ...evaluation, findings: foreign }));
      const unrelated = await invoke("check", repo, "--snapshot", snapshot, "--baseline", baseline);
      expect(unrelated.stderr).toContain("share no component");
    });
  });
});
