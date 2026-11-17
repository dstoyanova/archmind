import { describe, expect, it } from "vitest";

import { findCycles } from "./graph-cycles.js";

describe("findCycles", () => {
  it("returns multi-member components and self-loops with sorted members", () => {
    const cycles = findCycles({
      nodes: ["c", "b", "a", "d", "e"],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
        { from: "d", to: "d" },
        { from: "d", to: "e" }
      ]
    });

    expect(cycles).toEqual([["a", "b", "c"], ["d"]]);
  });

  it("ignores edges that reference unknown nodes", () => {
    expect(findCycles({ nodes: ["a"], edges: [{ from: "a", to: "missing" }] })).toEqual([]);
  });

  it("handles a very deep dependency chain without overflowing the stack", () => {
    const size = 50_000;
    const nodes = Array.from({ length: size }, (_, index) => `n${index}`);
    const edges = nodes.slice(1).map((to, index) => ({ from: `n${index}`, to }));
    edges.push({ from: `n${size - 1}`, to: "n0" });

    const cycles = findCycles({ nodes, edges });

    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toHaveLength(size);
  });
});
