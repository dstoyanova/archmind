import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { open, readdir, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

import { DEFAULT_SNAPSHOT_SCHEMA_VERSION, verifyContentHash } from "@archmind/architecture-engine";
import {
  architectureSnapshotStructureSchema,
  toSnapshotListItem,
  type SnapshotIdentity,
  type SnapshotListItem
} from "@archmind/contracts";
import { compareStrings, createSnapshotProjector } from "@archmind/domain";

import { fileFingerprint, readStableDocument } from "./local-document.js";
import type { SnapshotLoadResult, SnapshotReader } from "./snapshot-reader.js";

const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const CACHE_ENTRIES = 4;

interface CacheEntry<T> {
  fingerprint: string;
  result: Promise<T>;
}

function invalid(reason: string) {
  return { status: "invalid" as const, reason };
}

export class FileSnapshotReader implements SnapshotReader {
  private readonly cache = new Map<string, CacheEntry<SnapshotLoadResult>>();
  private readonly summaries = new Map<string, CacheEntry<SnapshotListItem>>();
  private readonly directory: string;

  constructor(directory: string) {
    this.directory = directory;
  }

  async list(): Promise<readonly SnapshotIdentity[]> {
    const entries = await readdir(this.directory, { withFileTypes: true });
    const identities = entries
      .filter(
        (entry) =>
          entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".evaluation.json")
      )
      .map(({ name }) => ({ id: createHash("sha256").update(name).digest("hex"), label: name }))
      .sort((left, right) => compareStrings(left.label, right.label));
    const ids = new Set(identities.map(({ id }) => id));
    for (const id of this.summaries.keys()) {
      if (!ids.has(id)) this.summaries.delete(id);
    }
    return identities;
  }

  summarize(identity: SnapshotIdentity): Promise<SnapshotListItem> {
    return this.read(
      identity,
      this.summaries,
      (reason) => ({ ...identity, ...invalid(reason) }),
      async (handle, stat, current) => {
        const loaded = this.cache.get(identity.id);
        const result = await (loaded?.fingerprint === current
          ? loaded.result
          : readSnapshot(handle, stat, current));
        return result.status === "ready"
          ? toSnapshotListItem(identity, result.data.snapshot)
          : { ...identity, ...result };
      }
    );
  }

  load(identity: SnapshotIdentity): Promise<SnapshotLoadResult> {
    return this.read(identity, this.cache, invalid, readSnapshot, CACHE_ENTRIES);
  }

  private async read<T>(
    identity: SnapshotIdentity,
    cache: Map<string, CacheEntry<T>>,
    unavailable: (reason: string) => T,
    read: (handle: FileHandle, stat: BigIntStats, current: string) => Promise<T>,
    capacity?: number
  ): Promise<T> {
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
        cache.delete(identity.id);
        return unavailable("Snapshot file is no longer available or readable.");
      }
      throw error;
    }

    try {
      const stat = await handle.stat({ bigint: true });
      if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) {
        cache.delete(identity.id);
        return unavailable(
          stat.isFile() ? "Snapshot exceeds the 16 MiB size limit." : "Not a regular snapshot file."
        );
      }

      const current = fileFingerprint(stat);
      const cached = cache.get(identity.id);
      cache.delete(identity.id);
      if (cached?.fingerprint === current) {
        cache.set(identity.id, cached);
        return cached.result;
      }

      const entry = { fingerprint: current, result: read(handle, stat, current) };
      cache.set(identity.id, entry);
      if (capacity !== undefined && cache.size > capacity) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      try {
        return await entry.result;
      } catch (error) {
        if (cache.get(identity.id) === entry) {
          cache.delete(identity.id);
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
  const text = await readStableDocument(handle, stat, initialFingerprint);
  if (text === undefined) {
    return invalid("Snapshot changed while being read. Retry after the write finishes.");
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
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
