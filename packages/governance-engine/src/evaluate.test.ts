import { ruleEvaluationSchema, rulesConfigSchema } from "@archmind/contracts";
import type {
  ArchitectureComponent,
  ArchitectureSnapshot,
  ComponentDependency,
  FileImport,
  FileRole
} from "@archmind/domain";
import { describe, expect, it } from "vitest";

import { evaluate, GOVERNANCE_ENGINE_VERSION } from "./index.js";

const metrics = { fileCount: 1, loc: 5, fanIn: 0, fanOut: 0, instability: 0 };
const components: ArchitectureComponent[] = [
  { id: "root", name: "<root>", kind: "root", depth: 0, paths: ["."], metrics },
  {
    id: "web",
    name: "web",
    kind: "package",
    depth: 1,
    parentId: "root",
    paths: ["apps/web"],
    metrics
  },
  {
    id: "api",
    name: "api",
    kind: "package",
    depth: 1,
    parentId: "root",
    paths: ["apps/api"],
    metrics
  },
  {
    id: "ui",
    name: "modules",
    kind: "folder",
    depth: 2,
    parentId: "web",
    paths: ["apps/web/src/modules"],
    metrics
  },
  {
    id: "service",
    name: "modules",
    kind: "folder",
    depth: 2,
    parentId: "api",
    paths: ["apps/api/src/modules"],
    metrics
  },
  {
    id: "nested",
    name: "feature",
    kind: "folder",
    depth: 3,
    parentId: "ui",
    paths: ["apps/web/src/modules/feature"],
    metrics: { ...metrics, fanOut: 11 }
  },
  {
    id: "api-nested",
    name: "feature",
    kind: "folder",
    depth: 3,
    parentId: "service",
    paths: ["apps/api/src/modules/feature"],
    metrics
  },
  {
    id: "configured",
    name: "boundary",
    kind: "configured",
    depth: 1,
    parentId: "root",
    paths: ["custom/**"],
    metrics
  },
  {
    id: "child",
    name: "receiver",
    kind: "configured",
    depth: 2,
    parentId: "configured",
    paths: ["other/**"],
    metrics
  }
];

type Edge = {
  from: string;
  to?: string;
  specifier?: string;
  builtIn?: boolean;
  packageName?: string;
  role?: FileRole;
  kind?: FileImport["kind"];
  line?: number;
  workspace?: boolean;
};

function snapshot(
  edges: readonly Edge[],
  list: readonly ArchitectureComponent[] = components
): ArchitectureSnapshot {
  const files = list.flatMap(({ id }) =>
    (["source", "test"] as const).map((role) => ({
      id: `${id}:${role}`,
      path: `${id}/index${role === "test" ? ".test" : ""}.ts`,
      componentId: id,
      role,
      language: "ts",
      loc: 5,
      parseStatus: "parsed" as const
    }))
  );
  const dependencies = new Map<string, ComponentDependency>();
  const fileImports = edges.map(
    (
      {
        from,
        to,
        packageName,
        role = "source",
        kind = "static",
        line,
        workspace,
        specifier,
        builtIn
      },
      index
    ): FileImport => {
      const id = `import:${index}`;
      if (to !== undefined) {
        const key = `${from}->${to}`;
        const group = dependencies.get(key) ?? {
          id: key,
          fromComponentId: from,
          toComponentId: to,
          weight: 0,
          countsByKind: {},
          countsByRole: {},
          evidenceImportIds: []
        };
        group.weight += 1;
        group.countsByKind[kind] = (group.countsByKind[kind] ?? 0) + 1;
        group.countsByRole[role] = (group.countsByRole[role] ?? 0) + 1;
        group.evidenceImportIds.push(id);
        dependencies.set(key, group);
      }
      return {
        id,
        fromFileId: `${from}:${role}`,
        specifier: specifier ?? (packageName ? `${packageName}/subpath` : (to ?? "./missing")),
        kind,
        line: line ?? index + 1,
        column: 1,
        resolution: builtIn
          ? "node-built-in"
          : workspace
            ? "workspace-package"
            : packageName
              ? "external-package"
              : to
                ? "internal-file"
                : "unresolved",
        toComponentId: to,
        toFileId: to && !workspace ? `${to}:source` : undefined,
        externalPackage: packageName
      };
    }
  );
  return {
    schemaVersion: "1",
    engineVersion: "1",
    parserVersion: "1",
    contentHash: "a".repeat(64),
    analysisConfigHash: "b".repeat(64),
    source: { kind: "local", sourceHash: "c".repeat(64) },
    createdAt: "2026-11-21T12:00:00.000Z",
    components: [...list],
    files,
    fileImports,
    dependencies: [...dependencies.values()],
    externalDependencies: [],
    cycles: [],
    symbols: [],
    diagnostics: edges.some((edge) => edge.workspace)
      ? [
          {
            severity: "warning",
            code: "WORKSPACE_ENTRY_UNMAPPED",
            message: "No analysed entry point."
          }
        ]
      : [],
    resolutionStats: { countsByResolution: {}, unresolvedRate: 0 }
  };
}

function run(input: ArchitectureSnapshot, definitions: unknown[] = [], defaults = false) {
  return evaluate(
    input,
    rulesConfigSchema.parse({
      definitions,
      disableDefaults: defaults ? [] : ["archmind/no-cycles", "archmind/high-coupling"]
    }),
    GOVERNANCE_ENGINE_VERSION
  );
}

const forbidden = {
  id: "boundary",
  severity: "error",
  type: "forbidden-dependency",
  from: [{ path: "apps/web" }],
  to: [{ path: "apps/api" }]
};
const cycles = { id: "cycles", severity: "error", type: "no-cycles" };
const threshold = {
  id: "metric",
  severity: "warning",
  type: "threshold",
  components: [{ path: "apps/web/src/modules/*" }],
  metric: "fanOut",
  max: 10
};

describe("governance evaluation", () => {
  it("finds a nested-to-package dependency through an unmapped workspace import, but not a folder-level target", () => {
    const input = snapshot([
      { from: "nested", to: "api", workspace: true },
      { from: "nested", role: "test", to: "api" }
    ]);
    const result = run(input, [
      forbidden,
      { ...forbidden, id: "folder", to: [{ path: "apps/api/src/*" }] },
      threshold
    ]);
    expect(ruleEvaluationSchema.parse(result)).toEqual(result);
    expect(result.diagnostics).toEqual([]);
    expect(result.findings).toMatchObject([
      {
        ruleId: "boundary",
        message: "Forbidden dependency from apps/web/src/modules/feature to apps/api.",
        subject: { kind: "dependency", fromComponentId: "nested", toComponentId: "api" },
        evidenceTotal: 1,
        evidence: [
          {
            filePath: "nested/index.ts",
            line: 1,
            column: 1,
            specifier: "api",
            kind: "static",
            role: "source"
          }
        ]
      },
      {
        ruleId: "metric",
        subject: { kind: "components", componentIds: ["nested"] },
        evidenceTotal: 0
      }
    ]);
  });

  it("checks layer order using the nearest ancestor and diagnoses ties", () => {
    const input = snapshot([
      { from: "ui", to: "child" }, // highest to lowest skips the middle layer
      { from: "nested", to: "ui" }, // nested override makes this an upward edge
      { from: "service", to: "nested" } // both middle
    ]);
    const layering = {
      id: "layers",
      type: "layers",
      severity: "error",
      layers: [
        { name: "top", components: [{ path: "apps/web" }] },
        {
          name: "middle",
          components: [{ path: "apps/api" }, { path: "apps/web/src/modules/feature" }]
        },
        { name: "bottom", components: [{ name: "boundary" }] }
      ]
    };
    expect(run(input, [layering]).findings).toMatchObject([
      { subject: { fromComponentId: "nested", toComponentId: "ui" }, evidenceTotal: 1 }
    ]);
    const ambiguous = run(input, [
      {
        ...layering,
        layers: [...layering.layers, { name: "also-top", components: [{ path: "apps/web" }] }]
      }
    ]);
    expect(ambiguous.findings).toEqual([]);
    expect(ambiguous.diagnostics).toMatchObject([{ code: "AMBIGUOUS_LAYER", ruleId: "layers" }]);
  });

  it("uses configured names only, and inherits allowlists through hierarchy rather than path prefixes", () => {
    const result = run(
      snapshot([
        { from: "child", packageName: "@vendor/storage" },
        { from: "nested", packageName: "@vendor/storage", role: "test" },
        { from: "nested", packageName: "@vendor/storage", kind: "type-only" },
        { from: "ui", packageName: "@vendor/storage-extra" }
      ]),
      [
        {
          id: "storage",
          severity: "error",
          type: "restricted-package",
          packages: ["@vendor/storage"],
          allow: [{ name: "boundary" }],
          scope: { additionalFileRoles: ["test"], includeTypeOnly: false }
        },
        { ...forbidden, id: "name-typo", from: [{ name: "modules" }] }
      ]
    );
    expect(result.findings).toMatchObject([
      {
        ruleId: "storage",
        subject: {
          kind: "external-package",
          componentId: "nested",
          packageName: "@vendor/storage"
        },
        evidence: [{ role: "test" }]
      }
    ]);
    expect(result.diagnostics).toMatchObject([
      { ruleId: "name-typo", field: "from.0", code: "SELECTOR_NO_MATCH" }
    ]);
  });

  it("reports a cycle once at the finest supported depth and retains coarser cycles with extra support", () => {
    const edges: Edge[] = [
      { from: "nested", to: "api-nested" },
      { from: "api-nested", to: "nested" }
    ];
    const deepest = { componentIds: ["api-nested", "nested"] };
    expect(run(snapshot(edges), [cycles]).findings.map(({ subject }) => subject)).toEqual([
      { kind: "components", ...deepest }
    ]);
    const partlyOverlapping = run(snapshot([...edges, { from: "ui", to: "service" }]), [
      cycles
    ]).findings;
    expect(partlyOverlapping).toHaveLength(2);
    expect(partlyOverlapping).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subject: { kind: "components", ...deepest }, evidenceTotal: 2 }),
        expect.objectContaining({
          subject: { kind: "components", componentIds: ["service", "ui"] },
          evidenceTotal: 3
        })
      ])
    );
    const coarseOnly = run(
      snapshot([
        { from: "nested", to: "api-nested" },
        { from: "service", to: "ui" }
      ]),
      [cycles]
    );
    expect(coarseOnly.findings).toMatchObject([{ subject: { componentIds: ["service", "ui"] } }]);
    expect(
      run(snapshot(edges), [{ ...cycles, components: [{ path: "apps/web" }] }]).findings
    ).toEqual([]);
  });

  it("defaults to production scope, ignores type-only cycles, and warns for fanOut above 10", () => {
    const input = snapshot([
      { from: "nested", to: "api-nested", kind: "type-only" },
      { from: "api-nested", to: "nested", kind: "type-only" },
      { from: "ui", to: "service", role: "test" },
      { from: "service", to: "ui", role: "test" }
    ]);
    const custom = [
      {
        ...cycles,
        id: "test-cycle",
        scope: { additionalFileRoles: ["test"], includeTypeOnly: false }
      },
      { ...cycles, id: "type-cycle", includeTypeOnlyCycles: true },
      {
        ...forbidden,
        id: "scoped-edge",
        scope: { additionalFileRoles: ["test"], includeTypeOnly: false }
      }
    ];
    expect(run(input, custom, true).findings).toMatchObject([
      {
        ruleId: "archmind/high-coupling",
        severity: "warning",
        subject: { componentIds: ["nested"] }
      },
      {
        ruleId: "scoped-edge",
        subject: { fromComponentId: "ui", toComponentId: "service" },
        evidenceTotal: 1
      },
      { ruleId: "test-cycle", subject: { componentIds: ["service", "ui"] }, evidenceTotal: 2 },
      {
        ruleId: "type-cycle",
        subject: { componentIds: ["api-nested", "nested"] },
        evidenceTotal: 2
      }
    ]);
    expect(
      run(
        snapshot([
          { from: "web", to: "api" },
          { from: "api", to: "web" }
        ]),
        [],
        true
      ).findings
    ).toContainEqual(
      expect.objectContaining({ ruleId: "archmind/no-cycles", severity: "error", ruleVersion: "1" })
    );
  });

  it("applies the default coupling rule to leaf components only, and custom thresholds to every selected component", () => {
    const busy = { ...metrics, fanOut: 11 };
    const list = components.map((item) =>
      item.id === "ui" || item.id === "nested" ? { ...item, metrics: busy } : item
    );
    const input = snapshot([], list);
    const everyDepth = {
      ...threshold,
      components: [{ path: "apps/web/src/modules" }, { path: "apps/web/src/modules/feature" }]
    };

    expect(run(input, [], true).findings).toMatchObject([
      { ruleId: "archmind/high-coupling", subject: { componentIds: ["nested"] } }
    ]);
    expect(
      run(input, [everyDepth])
        .findings.flatMap(({ subject }) =>
          subject.kind === "components" ? subject.componentIds : []
        )
        .sort()
    ).toEqual(["nested", "ui"]);
  });

  it("caps and sorts distinct evidence and keeps fingerprints stable across unrelated edits", () => {
    const edges: Edge[] = Array.from({ length: 25 }, (_, index) => ({
      from: "nested",
      to: "api",
      line: 25 - index
    }));
    const input = snapshot([...edges, { from: "nested", to: "api", line: 1 }]);
    const first = run(input, [forbidden, threshold]);
    expect(first).toEqual(run(input, [threshold, forbidden]));
    const finding = first.findings.find(({ ruleId }) => ruleId === "boundary");
    expect(finding?.evidenceTotal).toBe(25);
    expect(finding?.evidence.map(({ line }) => line)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1)
    );

    const edited = snapshot([
      { from: "child", to: "configured" },
      ...edges.map((edge) => ({ ...edge, line: (edge.line ?? 0) + 5 }))
    ]);
    edited.contentHash = "d".repeat(64);
    const changed = run(edited, [threshold, { ...forbidden, severity: "warning" }]);
    expect(changed.findings.map(({ fingerprint }) => fingerprint)).toEqual(
      first.findings.map(({ fingerprint }) => fingerprint)
    );
    expect(changed.findings[0]?.ruleVersion).not.toBe(finding?.ruleVersion);
    expect(run(edited, [{ ...forbidden, id: "renamed" }]).findings[0]?.fingerprint).not.toBe(
      finding?.fingerprint
    );
  });

  it("keeps a cycle's fingerprint when it gains an internal edge, and changes it when a member joins", () => {
    const ring: Edge[] = [
      { from: "nested", to: "api-nested" },
      { from: "api-nested", to: "nested" }
    ];
    const [before] = run(snapshot(ring), [cycles]).findings;
    const [moreEdges] = run(snapshot([...ring, { from: "nested", to: "api-nested", line: 99 }]), [
      cycles
    ]).findings;
    expect(moreEdges?.fingerprint).toBe(before?.fingerprint);

    const wider = run(
      snapshot([
        { from: "nested", to: "child" },
        { from: "child", to: "api-nested" },
        { from: "api-nested", to: "nested" }
      ]),
      [cycles]
    ).findings;
    expect(wider).toHaveLength(1);
    expect(wider[0]?.fingerprint).not.toBe(before?.fingerprint);
  });

  it("names at most five members of a cycle in its message, and keeps all of them in the subject", () => {
    const ring = Array.from({ length: 7 }, (_, index) => ({
      id: `lib-${index}`,
      name: `lib-${index}`,
      kind: "package" as const,
      depth: 1,
      parentId: "root",
      paths: [`libs/lib-${index}`],
      metrics
    }));
    const edges = ring.map(({ id }, index) => ({ from: id, to: ring[(index + 1) % 7]?.id ?? id }));
    const [finding] = run(snapshot(edges, [components[0] as ArchitectureComponent, ...ring]), [
      cycles
    ]).findings;
    expect(finding?.subject).toMatchObject({ componentIds: expect.arrayContaining(["lib-6"]) });
    expect(finding?.message).toMatch(
      /^Dependency cycle involving (?:libs\/lib-\d; ){4}libs\/lib-\d and 2 more\.$/u
    );
  });

  it("restricts Node.js built-ins by their node: name, including subpaths, and rejects bare names", () => {
    const restricted = {
      id: "no-fs",
      severity: "error",
      type: "restricted-package",
      packages: ["node:fs"],
      allow: [{ name: "boundary" }]
    };
    const result = run(
      snapshot([
        { from: "nested", specifier: "node:fs", builtIn: true },
        { from: "nested", specifier: "fs/promises", builtIn: true },
        { from: "ui", specifier: "node:path", builtIn: true },
        { from: "child", specifier: "node:fs", builtIn: true }
      ]),
      [restricted]
    );
    expect(result.findings).toMatchObject([
      { subject: { componentId: "nested", packageName: "node:fs" }, evidenceTotal: 2 }
    ]);

    const bare = run(snapshot([{ from: "nested", specifier: "fs", builtIn: true }]), [
      { ...restricted, id: "bare-fs", packages: ["fs"] }
    ]);
    expect(bare.findings).toEqual([]);
    expect(bare.diagnostics).toMatchObject([
      { ruleId: "bare-fs", code: "BUILT_IN_MODULE_NAME", field: "packages.0" }
    ]);
  });
});
