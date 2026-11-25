import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { open, readdir, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { ruleEvaluationSchema, type RuleEvaluation } from "@archmind/contracts";
import { compareStrings } from "@archmind/domain";
import { GOVERNANCE_ENGINE_VERSION } from "@archmind/governance-engine";

import { fileFingerprint, readStableDocument } from "../architecture-model/local-document.js";

export const EVALUATION_READER = Symbol("EvaluationReader");
const MAX_BYTES = 16 * 1024 * 1024;
const CACHE_ENTRIES = 8;

export interface EvaluationIdentity {
  id: string;
  label: string;
}

type LoadResult =
  | { status: "ready"; evaluation: RuleEvaluation; revision: string }
  | { status: "invalid"; reason: string };

export interface EvaluationReader {
  list(): Promise<readonly EvaluationIdentity[]>;
  load(identity: EvaluationIdentity): Promise<LoadResult>;
}

function invalid(reason: string): LoadResult {
  return { status: "invalid", reason };
}

export class FileEvaluationReader implements EvaluationReader {
  private readonly cache = new Map<string, { revision: string; result: Promise<LoadResult> }>();

  constructor(private readonly directory: string) {}

  async list(): Promise<readonly EvaluationIdentity[]> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".evaluation.json")
      )
      .map(({ name }) => ({ id: createHash("sha256").update(name).digest("hex"), label: name }))
      .sort((a, b) => compareStrings(a.label, b.label));
  }

  async load(identity: EvaluationIdentity): Promise<LoadResult> {
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
        this.cache.delete(identity.id);
        return invalid("Evaluation file is not available, readable, or is a symbolic link.");
      }
      throw error;
    }

    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || stat.size > MAX_BYTES) {
        this.cache.delete(identity.id);
        return invalid(
          stat.isFile()
            ? "Evaluation exceeds the 16 MiB size limit."
            : "Not a regular evaluation file."
        );
      }
      const revision = fileFingerprint(stat);
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
    } finally {
      await handle.close();
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
  if (parsed.data.governanceEngineVersion !== GOVERNANCE_ENGINE_VERSION) {
    return invalid("Governance engine version is not supported.");
  }
  const fingerprints = new Set(parsed.data.findings.map((item) => item.fingerprint));
  if (fingerprints.size !== parsed.data.findings.length)
    return invalid("Evaluation has duplicate finding fingerprints.");
  return { status: "ready", evaluation: parsed.data, revision };
}
