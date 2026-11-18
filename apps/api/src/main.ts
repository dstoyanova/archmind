import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { env } from "node:process";
import { URL } from "node:url";

import { createExplorerApp } from "./app.js";

const portText = env.PORT ?? "3001";
const port = Number(portText);
if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer from 1 to 65535.");
}
const directory = env.ARCHMIND_SNAPSHOT_DIR;
if (!directory?.trim()) throw new Error("Set ARCHMIND_SNAPSHOT_DIR to the snapshot directory.");
const snapshotDirectory = resolve(directory);
if (!(await stat(snapshotDirectory)).isDirectory()) {
  throw new Error("ARCHMIND_SNAPSHOT_DIR must point to a directory.");
}

const webOrigin = env.ARCHMIND_WEB_ORIGIN;
if (webOrigin !== undefined) {
  const url = URL.canParse(webOrigin) ? new URL(webOrigin) : undefined;
  if (!url || !["http:", "https:"].includes(url.protocol) || url.origin !== webOrigin) {
    throw new Error("ARCHMIND_WEB_ORIGIN must be an HTTP(S) origin without a trailing slash.");
  }
}

const app = await createExplorerApp({
  snapshotDirectory,
  ...(webOrigin === undefined ? {} : { webOrigin })
});
app.enableShutdownHooks();
try {
  await app.listen(port, "127.0.0.1");
} catch (error) {
  await app.close();
  throw error;
}
