import { describe, expect, it } from "vitest";

import { canonicalJson } from "./canonical-json.js";
import { compareStrings } from "./ordering.js";

describe("compareStrings", () => {
  it("orders by code unit, independent of locale", () => {
    expect(["ä", "z", "a", "B"].sort(compareStrings)).toEqual(["B", "a", "z", "ä"]);
    expect(compareStrings("a", "a")).toBe(0);
  });
});

describe("canonicalJson", () => {
  it("sorts keys by code unit at every depth and omits undefined properties", () => {
    expect(
      canonicalJson({ b: 1, B: { z: [2, { y: undefined, x: 1 }], ä: "x" }, a: undefined })
    ).toBe('{"B":{"z":[2,{"x":1}],"ä":"x"},"b":1}');
  });

  it("keeps integer-like keys in sorted order and preserves array order", () => {
    expect(canonicalJson({ "10": 1, "2": 2, list: [3, 1, 2] })).toBe(
      '{"10":1,"2":2,"list":[3,1,2]}'
    );
  });

  it("rejects values that have no canonical form", () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/non-finite/u);
    expect(() => canonicalJson({ value: () => 1 })).toThrow(/function/u);
  });
});
