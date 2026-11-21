import { createHash } from "node:crypto";

import { canonicalJson } from "@archmind/domain";

import type { RulesConfig } from "./rules-schema.js";

export function computeRulesHash(rules: RulesConfig): string {
  return createHash("sha256").update(canonicalJson(rules)).digest("hex");
}
