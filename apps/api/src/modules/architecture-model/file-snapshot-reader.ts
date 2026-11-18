import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { open, readdir, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_SNAPSHOT_SCHEMA_VERSION, verifyContentHash } from "@archmind/architecture-engine";
import { architectureSnapshotStructureSchema, type SnapshotIdentity } from "@archmind/contracts";
import { compareStrings, createSnapshotProjector } from "@archmind/domain";

import type { SnapshotLoadResult, SnapshotReader } from "./snapshot-reader.js";

const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const CACHE_ENTRIES = 4;

interface CacheEntry {
  fingerprint: string;
  result: Promise<SnapshotLoadResult>;
}

function invalid(reason: string): SnapshotLoadResult {
  return { status: "invalid", reason };
}

function fingerprint(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

export class FileSnapshotReader implements SnapshotReader {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async list(): Promise<readonly SnapshotIdentity[]> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    return entries
      .filter(
        (entry) =>
          entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".evaluation.json")
      )
      .map(({ name }) => ({ id: createHash("sha256").update(name).digest("hex"), label: name }))
      .sort((left, right) => compareStrings(left.label, right.label));
  }

  async load(identity: SnapshotIdentity): Promise<SnapshotLoadResult> {
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
        return invalid("Snapshot file is no longer available or readable.");
      }
      throw error;
    }

    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) {
        this.cache.delete(identity.id);
        return invalid(
          stat.isFile() ? "Snapshot exceeds the 16 MiB size limit." : "Not a regular snapshot file."
        );
      }

      const current = fingerprint(stat);
      const cached = this.cache.get(identity.id);
      this.cache.delete(identity.id);
      if (cached?.fingerprint === current) {
        this.cache.set(identity.id, cached);
        return cached.result;
      }

      const entry = { fingerprint: current, result: readSnapshot(handle, stat, current) };
      this.cache.set(identity.id, entry);
      const oldest = this.cache.keys().next().value;
      if (this.cache.size > CACHE_ENTRIES && oldest !== undefined) {
        this.cache.delete(oldest);
      }
      try {
        return await entry.result;
      } catch (error) {
        if (this.cache.get(identity.id) === entry) {
          this.cache.delete(identity.id);
        }
        throw error;
      }
    } finally {
      await handle.close();
    }
  }
}

async function readSnapshot(
  handle: FileHandle,
  stat: BigIntStats,
  initialFingerprint: string
): Promise<SnapshotLoadResult> {
  const buffer = Buffer.alloc(Number(stat.size) + 1);
  let length = 0;
  while (length < buffer.length) {
    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  if (
    length !== Number(stat.size) ||
    fingerprint(await handle.stat({ bigint: true })) !== initialFingerprint
  ) {
    return invalid("Snapshot changed while being read. Retry after the write finishes.");
  }

  let json: unknown;
  try {
    json = JSON.parse(buffer.toString("utf8", 0, length));
  } catch (error) {
    if (error instanceof SyntaxError) return invalid("Snapshot is not valid JSON.");
    throw error;
  }

  const parsed = architectureSnapshotStructureSchema.safeParse(json);
  if (!parsed.success) return invalid("Snapshot does not match the document schema.");
  const snapshot = parsed.data;
  if (snapshot.schemaVersion !== DEFAULT_SNAPSHOT_SCHEMA_VERSION) {
    return invalid("Snapshot schema version is not supported.");
  }
  // The structure-only parse leaves invariant validation to the projector, which also builds its indexes.
  let projector: LoadedProjector;
  try {
    projector = createSnapshotProjector(snapshot);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Snapshot invariants failed:")) {
      return invalid("Snapshot graph contains invalid references or hierarchy.");
    }
    throw error;
  }
  if (!verifyContentHash(snapshot)) return invalid("Snapshot content hash does not match.");

  return {
    status: "ready",
    data: {
      snapshot,
      projector,
      importsById: new Map(snapshot.fileImports.map((item) => [item.id, item])),
      filesById: new Map(snapshot.files.map((file) => [file.id, file]))
    }
  };
}

type LoadedProjector = ReturnType<typeof createSnapshotProjector>;
