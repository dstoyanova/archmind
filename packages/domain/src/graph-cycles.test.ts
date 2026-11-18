import { describe, expect, it } from "vitest";

import { findCycles, findTypedCycles } from "./graph-cycles.js";

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

    describe("findTypedCycles", () => {
      it("marks a cycle as runtime when any runtime cycle survives within its members", () => {
        expect(
          findTypedCycles({
            nodes: ["e", "c", "b", "a", "d"],
            edges: [
              { from: "a", to: "b", typeOnly: false },
              { from: "b", to: "a", typeOnly: false },
              { from: "b", to: "c", typeOnly: true },
              { from: "c", to: "a", typeOnly: false },
              { from: "d", to: "e", typeOnly: true },
              { from: "e", to: "d", typeOnly: false }
            ]
          })
        ).toEqual([
          { memberIds: ["a", "b", "c"], typeOnly: false },
          { memberIds: ["d", "e"], typeOnly: true }
        ]);
      });
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
