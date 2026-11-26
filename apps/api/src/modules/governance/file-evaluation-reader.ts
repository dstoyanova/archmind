import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { open, readdir, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { ruleEvaluationSchema, type RuleEvaluation } from "@archmind/contracts";
import { compareStrings } from "@archmind/domain";

import { fileFingerprint, readStableDocument } from "../architecture-model/local-document.js";

export const EVALUATION_READER = Symbol("EvaluationReader");
const MAX_BYTES = 16 * 1024 * 1024;
const CACHE_ENTRIES = 8;

export interface EvaluationIdentity {
  id: string;
  label: string;
}

type Invalid = { status: "invalid"; reason: string };
type LoadResult = { status: "ready"; evaluation: RuleEvaluation; revision: string } | Invalid;
export type EvaluationMetadata = Omit<RuleEvaluation, "findings" | "diagnostics"> & {
  findingCount: number;
};
type SummaryResult = { status: "ready"; metadata: EvaluationMetadata; revision: string } | Invalid;

export interface EvaluationReader {
  list(): Promise<readonly EvaluationIdentity[]>;
  /** Cheap per-file summary, cached by file fingerprint like snapshot list items. */
  summarize(identity: EvaluationIdentity): Promise<SummaryResult>;
  load(identity: EvaluationIdentity): Promise<LoadResult>;
}

function invalid(reason: string): Invalid {
  return { status: "invalid", reason };
}

function summarize(result: LoadResult): SummaryResult {
  if (result.status === "invalid") return result;
  const { evaluation, revision } = result;
  return {
    status: "ready",
    metadata: {
      schemaVersion: evaluation.schemaVersion,
      governanceEngineVersion: evaluation.governanceEngineVersion,
      rulesHash: evaluation.rulesHash,
      contentHash: evaluation.contentHash,
      analysisConfigHash: evaluation.analysisConfigHash,
      createdAt: evaluation.createdAt,
      findingCount: evaluation.findings.length
    },
    revision
  };
}

export class FileEvaluationReader implements EvaluationReader {
  private readonly cache = new Map<string, { revision: string; result: Promise<LoadResult> }>();
  private readonly summaries = new Map<string, { revision: string; result: SummaryResult }>();

  constructor(private readonly directory: string) {}

  async list(): Promise<readonly EvaluationIdentity[]> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    const identities = entries
      .filter(
        (entry) =>
          (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".evaluation.json")
      )
      .map(({ name }) => ({ id: createHash("sha256").update(name).digest("hex"), label: name }))
      .sort((a, b) => compareStrings(a.label, b.label));
    const listed = new Set(identities.map(({ id }) => id));
    for (const id of this.summaries.keys()) {
      if (!listed.has(id)) this.summaries.delete(id);
    }
    return identities;
  }

  async summarize(identity: EvaluationIdentity): Promise<SummaryResult> {
    return this.withFile(identity, async (handle, stat, revision) => {
      const cached = this.summaries.get(identity.id);
      if (cached?.revision === revision) return cached.result;
      const result = summarize(await this.read(identity, handle, stat, revision));
      this.summaries.set(identity.id, { revision, result });
      return result;
    });
  }

  load(identity: EvaluationIdentity): Promise<LoadResult> {
    return this.withFile(identity, (handle, stat, revision) =>
      this.read(identity, handle, stat, revision)
    );
  }

  private forget(identity: EvaluationIdentity): void {
    this.cache.delete(identity.id);
    this.summaries.delete(identity.id);
  }

  private async withFile<T>(
    identity: EvaluationIdentity,
    use: (handle: FileHandle, stat: BigIntStats, revision: string) => Promise<T>
  ): Promise<T | Invalid> {
    let handle: FileHandle;
    try {
      handle = await open(
        join(this.directory, identity.label),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      );
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["ENOENT", "ELOOP", "EACCES", "EPERM"].some((code) => code === error.code)
      ) {
        this.forget(identity);
        return invalid("Evaluation file is not available, readable, or is a symbolic link.");
      }
      throw error;
    }

    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || stat.size > MAX_BYTES) {
        this.forget(identity);
        return invalid(
          stat.isFile()
            ? "Evaluation exceeds the 16 MiB size limit."
            : "Not a regular evaluation file."
        );
      }
      return await use(handle, stat, fileFingerprint(stat));
    } finally {
      await handle.close();
    }
  }

  private async read(
    identity: EvaluationIdentity,
    handle: FileHandle,
    stat: BigIntStats,
    revision: string
  ): Promise<LoadResult> {
    const cached = this.cache.get(identity.id);
    const entry =
      cached?.revision === revision
        ? cached
        : { revision, result: readEvaluation(handle, stat, revision) };
    this.cache.delete(identity.id);
    this.cache.set(identity.id, entry);
    const oldest = this.cache.keys().next().value;
    if (this.cache.size > CACHE_ENTRIES && oldest !== undefined) this.cache.delete(oldest);
    try {
      return await entry.result;
    } catch (error) {
      if (this.cache.get(identity.id) === entry) this.cache.delete(identity.id);
      throw error;
    }
  }
}

async function readEvaluation(
  handle: FileHandle,
  stat: BigIntStats,
  revision: string
): Promise<LoadResult> {
  const text = await readStableDocument(handle, stat, revision);
  if (text === undefined)
    return invalid("Evaluation changed while being read. Retry after the write finishes.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return invalid("Evaluation is not valid JSON.");
    throw error;
  }
  const parsed = ruleEvaluationSchema.safeParse(json);
  if (!parsed.success) {
    return invalid(
      parsed.error.issues.some((issue) => issue.path[0] === "schemaVersion")
        ? "Evaluation schema version is missing or not supported."
        : "Evaluation does not match the document schema."
    );
  }
  const fingerprints = new Set(parsed.data.findings.map((item) => item.fingerprint));
  if (fingerprints.size !== parsed.data.findings.length)
    return invalid("Evaluation has duplicate finding fingerprints.");
  return { status: "ready", evaluation: parsed.data, revision };
}
