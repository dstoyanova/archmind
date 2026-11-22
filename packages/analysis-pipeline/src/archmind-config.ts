import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { type AnalysisConfig } from "@archmind/contracts";
import { canonicalJson } from "@archmind/domain";

export const CONFIG_FILENAME = "archmind.config.json";

export async function readArchmindConfig(repositoryRoot: string): Promise<unknown> {
  const configPath = path.join(repositoryRoot, CONFIG_FILENAME);
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in "${CONFIG_FILENAME}": ${String(error)}`, { cause: error });
  }
}

export function computeAnalysisConfigHash(config: AnalysisConfig): string {
  return createHash("sha256").update(canonicalJson(config)).digest("hex");
}
