import { compareStrings } from "./ordering.js";

/**
 * Serialises a JSON-compatible value deterministically: no whitespace, object
 * keys sorted by `compareStrings`, `undefined` properties omitted. Array order is
 * preserved, so callers own collection ordering.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(`Cannot canonicalise non-finite number "${String(value)}".`);
      }

      return JSON.stringify(value);
    case "object":
      return Array.isArray(value) ? serialiseArray(value) : serialiseObject(value);
    default:
      throw new Error(`Cannot canonicalise a value of type "${typeof value}".`);
  }
}

function serialiseArray(values: unknown[]): string {
  return `[${values.map((entry) => (entry === undefined ? "null" : canonicalJson(entry))).join(",")}]`;
}

function serialiseObject(value: object): string {
  const entries = Object.entries(value)
    .filter((entry) => entry[1] !== undefined)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);

  return `{${entries.join(",")}}`;
}
