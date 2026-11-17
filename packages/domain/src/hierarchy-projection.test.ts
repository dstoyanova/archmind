import { describe, expect, it } from "vitest";

import { collectVisibleComponentIds, projectEdgesToDepth } from "./hierarchy-projection.js";

const components = [
  { id: "package", depth: 1 },
  { id: "folder", parentId: "package", depth: 2 },
  { id: "leaf", parentId: "folder", depth: 3 }
];

describe("collectVisibleComponentIds", () => {
  it("includes components up to the depth plus children of expanded components", () => {
    expect([...collectVisibleComponentIds(components, 1)]).toEqual(["package"]);
    expect([...collectVisibleComponentIds(components, 1, new Set(["package"]))].sort()).toEqual([
      "folder",
      "package"
    ]);
  });
});

describe("projectEdgesToDepth", () => {
  it("keeps edges from files owned directly by a parent attached to that parent", () => {
    const edges = [
      { fromComponentId: "package", toComponentId: "folder" },
      { fromComponentId: "leaf", toComponentId: "package" }
    ];

    expect(projectEdgesToDepth(components, edges, 2)).toEqual([
      { from: "folder", to: "package", typeOnly: false },
      { from: "package", to: "folder", typeOnly: false }
    ]);
  });

  it("drops edges inside one visible node and marks an edge type-only only when all evidence is", () => {
    const edges = [
      { fromComponentId: "leaf", toComponentId: "folder" },
      { fromComponentId: "folder", toComponentId: "package", typeOnly: true },
      { fromComponentId: "leaf", toComponentId: "package", typeOnly: true },
      { fromComponentId: "leaf", toComponentId: "package" }
    ];

    expect(projectEdgesToDepth(components, edges, 2)).toEqual([
      { from: "folder", to: "package", typeOnly: false }
    ]);
    expect(projectEdgesToDepth(components, edges.slice(1, 3), 2)).toEqual([
      { from: "folder", to: "package", typeOnly: true }
    ]);
  });
});
