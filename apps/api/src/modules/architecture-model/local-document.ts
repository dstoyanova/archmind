import { Buffer } from "node:buffer";
import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";

export function fileFingerprint(stat: BigIntStats): string {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

export async function readStableDocument(
  handle: FileHandle,
  stat: BigIntStats,
  initialFingerprint: string
): Promise<string | undefined> {
  const buffer = Buffer.alloc(Number(stat.size) + 1);
  let length = 0;
  while (length < buffer.length) {
    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  if (
    length !== Number(stat.size) ||
    fileFingerprint(await handle.stat({ bigint: true })) !== initialFingerprint
  ) {
    return undefined;
  }
  return buffer.toString("utf8", 0, length);
}
