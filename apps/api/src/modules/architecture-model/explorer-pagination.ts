import { createHash } from "node:crypto";

import type { PageQuery } from "@archmind/contracts";
import { canonicalJson } from "@archmind/domain";
import { HttpException } from "@nestjs/common";

export function paginate<T>(items: readonly T[], query: PageQuery, scope: object) {
  const key = createHash("sha256").update(canonicalJson(scope)).digest("hex");
  let start = 0;
  if (query.cursor !== undefined) {
    const [cursorKey, offset, extra] = query.cursor.split(".");
    if (cursorKey === key && offset !== undefined && /^\d+$/.test(offset) && extra === undefined) {
      start = Number(offset);
    }
    if (!Number.isSafeInteger(start) || start < 1 || start > items.length) {
      throw new HttpException(
        { error: { code: "INVALID_CURSOR", message: "Invalid continuation cursor." } },
        400
      );
    }
  }
  const end = start + query.limit;
  return {
    items: items.slice(start, end),
    nextCursor: end < items.length ? `${key}.${end}` : null
  };
}
