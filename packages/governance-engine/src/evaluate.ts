import { createHash } from "node:crypto";
import { builtinModules } from "node:module";

import {
  enabledDefaultRuleIds,
  FINDING_EVIDENCE_LIMIT,
  RULE_EVALUATION_SCHEMA_VERSION,
  type DependencyEvidence,
  type FindingSubject,
  type RuleDefinition,
  type RuleDiagnostic,
  type RuleEvaluation,
  type RuleFinding,
  type RulesConfig
} from "@archmind/contracts";
import { computeRulesHash } from "@archmind/contracts/rules-hash";
import {
  canonicalJson,
  compareStrings,
  createImportFilter,
  createSnapshotProjector,
  findVisibleAncestor,
  type ArchitectureComponent,
  type ArchitectureSnapshot,
  type FileImport,
  type ProjectedGraph,
  type ProjectGraphFilters
} from "@archmind/domain";

import { collectCycleSupport } from "./cycle-findings.js";
import { defaultRules } from "./defaults.js";
import { createSelectorIndex } from "./selectors.js";

export const GOVERNANCE_ENGINE_VERSION = "0.2.0";
const MESSAGE_MEMBER_LIMIT = 5;
const NODE_PREFIX = "node:";

type GraphRule = Exclude<RuleDefinition, { type: "threshold" }>;

function hash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function compareEvidence(a: DependencyEvidence, b: DependencyEvidence): number {
  return (
    compareStrings(a.filePath, b.filePath) ||
    a.line - b.line ||
    a.column - b.column ||
    compareStrings(a.specifier, b.specifier) ||
    compareStrings(a.kind, b.kind) ||
    compareStrings(a.role, b.role)
  );
}

function filtersFor(scope: GraphRule["scope"]): ProjectGraphFilters {
  return {
    includeFileRoles: ["source", ...scope.additionalFileRoles],
    includeTypeOnly: scope.includeTypeOnly
  };
}

function componentKey(component: ArchitectureComponent) {
  return component.kind === "configured"
    ? [component.kind, component.name]
    : [component.kind, [...component.paths].sort(compareStrings)];
}

export function evaluate(
  snapshot: ArchitectureSnapshot,
  rules: RulesConfig,
  governanceEngineVersion: string
): RuleEvaluation {
  const projector = createSnapshotProjector(snapshot);
  const components = [...snapshot.components].sort((a, b) => compareStrings(a.id, b.id));
  const componentById = new Map(components.map((component) => [component.id, component]));
  const parentById = new Map(components.map((component) => [component.id, component.parentId]));
  const filesById = new Map(snapshot.files.map((file) => [file.id, file]));
  const importsById = new Map(snapshot.fileImports.map((item) => [item.id, item]));
  const depths = [...new Set(components.map((component) => component.depth))].sort((a, b) => b - a);
  const maxDepth = depths[0] ?? 0;
  const selectors = createSelectorIndex(components, parentById);
  const graphCache = new Map<string, ProjectedGraph>();
  const diagnostics: RuleDiagnostic[] = [];
  const findings: RuleFinding[] = [];
  const activeRules: { rule: RuleDefinition; ruleVersion: string }[] = [
    ...enabledDefaultRuleIds(rules).map((id) => defaultRules[id]),
    ...rules.definitions.map((rule) => ({ rule, ruleVersion: hash(rule) }))
  ];

  function graphAt(depth: number, scope: GraphRule["scope"]): ProjectedGraph {
    const key = canonicalJson([depth, scope]);
    const cached = graphCache.get(key);
    if (cached) {
      return cached;
    }
    const graph = projector.projectGraph({ depth, filters: filtersFor(scope) });
    graphCache.set(key, graph);
    return graph;
  }

  function component(id: string): ArchitectureComponent {
    const value = componentById.get(id);
    if (!value) {
      throw new Error(`Unknown component "${id}" in governance evaluation.`);
    }
    return value;
  }

  function name(id: string): string {
    const { paths } = component(id);
    return [...paths].sort(compareStrings).join(", ") || id;
  }

  function keyOf(id: string) {
    return componentKey(component(id));
  }

  function subjectKey(subject: FindingSubject) {
    switch (subject.kind) {
      case "components":
        return [
          subject.kind,
          subject.componentIds.map((id) => canonicalJson(keyOf(id))).sort(compareStrings)
        ];
      case "dependency":
        return [subject.kind, keyOf(subject.fromComponentId), keyOf(subject.toComponentId)];
      case "external-package":
        return [subject.kind, keyOf(subject.componentId), subject.packageName];
    }
  }

  function readEvidence(ids: Iterable<string>): DependencyEvidence[] {
    const evidence = new Map<string, DependencyEvidence>();
    for (const id of ids) {
      const item = importsById.get(id);
      const file = item === undefined ? undefined : filesById.get(item.fromFileId);
      if (item === undefined || file === undefined) {
        throw new Error(`Invalid import evidence "${id}" in governance evaluation.`);
      }
      const { line, column, specifier, kind } = item;
      const entry = { filePath: file.path, line, column, specifier, kind, role: file.role };
      evidence.set(canonicalJson(entry), entry);
    }
    return [...evidence.values()].sort(compareEvidence);
  }

  for (const { rule, ruleVersion } of activeRules) {
    const select = selectors.forRule(rule.id, diagnostics);
    const initialDiagnostics = diagnostics.length;
    const valid = () => diagnostics.length === initialDiagnostics;
    const addFinding = (
      subject: FindingSubject,
      message: string,
      importIds: Iterable<string> = []
    ) => {
      const evidence = readEvidence(importIds);
      findings.push({
        ruleId: rule.id,
        ruleVersion,
        severity: rule.severity,
        subject,
        graphScope:
          rule.type === "threshold"
            ? { roles: ["source"], includeTypeOnly: true }
            : {
                roles: ["source", ...rule.scope.additionalFileRoles],
                includeTypeOnly: rule.scope.includeTypeOnly
              },
        message,
        evidence: evidence.slice(0, FINDING_EVIDENCE_LIMIT),
        evidenceTotal: evidence.length,
        fingerprint: hash([rule.id, subjectKey(subject)])
      });
    };

    switch (rule.type) {
      case "threshold": {
        const targets = selectors.withDescendants(select(rule.components, "components"));
        if (!valid()) {
          break;
        }
        for (const id of targets) {
          const value = component(id).metrics[rule.metric];
          if (value > rule.max) {
            addFinding(
              { kind: "components", componentIds: [id] },
              `${name(id)} has ${rule.metric} ${value}, above the maximum of ${rule.max}.`
            );
          }
        }
        break;
      }
      case "forbidden-dependency": {
        const sources = selectors.withDescendants(select(rule.from, "from"));
        const targets = selectors.withDescendants(select(rule.to, "to"));
        if (!valid()) {
          break;
        }
        for (const edge of graphAt(maxDepth, rule.scope).dependencies) {
          const { fromComponentId, toComponentId, evidenceImportIds } = edge;
          if (sources.has(fromComponentId) && targets.has(toComponentId)) {
            addFinding(
              { kind: "dependency", fromComponentId, toComponentId },
              `Forbidden dependency from ${name(fromComponentId)} to ${name(toComponentId)}.`,
              evidenceImportIds
            );
          }
        }
        break;
      }
      case "layers": {
        const assignments = new Map<string, number>();
        for (const [index, layer] of rule.layers.entries()) {
          for (const id of select(layer.components, `layers.${index}.components`)) {
            const other = assignments.get(id);
            if (other !== undefined) {
              diagnostics.push({
                ruleId: rule.id,
                code: "AMBIGUOUS_LAYER",
                field: `layers.${index}.components`,
                message: `${name(id)} matches both layer "${rule.layers[other]?.name}" and layer "${layer.name}".`
              });
            } else {
              assignments.set(id, index);
            }
          }
        }
        if (!valid()) {
          break;
        }
        const assigned = new Set(assignments.keys());
        const layerOf = new Map(
          components.map(({ id }) => {
            const ancestor = findVisibleAncestor(id, parentById, assigned);
            return [id, ancestor === undefined ? undefined : assignments.get(ancestor)];
          })
        );
        for (const { fromComponentId, toComponentId, evidenceImportIds } of graphAt(
          maxDepth,
          rule.scope
        ).dependencies) {
          const from = layerOf.get(fromComponentId);
          const to = layerOf.get(toComponentId);
          if (from !== undefined && to !== undefined && from > to) {
            addFinding(
              { kind: "dependency", fromComponentId, toComponentId },
              `${name(fromComponentId)} (layer "${rule.layers[from]?.name}") depends on ${name(toComponentId)} (higher layer "${rule.layers[to]?.name}").`,
              evidenceImportIds
            );
          }
        }
        break;
      }
      case "restricted-package": {
        const allowed = selectors.withDescendants(select(rule.allow, "allow"));
        for (const [index, name] of rule.packages.entries()) {
          if (builtinModules.includes(name)) {
            diagnostics.push({
              ruleId: rule.id,
              code: "BUILT_IN_MODULE_NAME",
              field: `packages.${index}`,
              message: `"${name}" is a Node.js built-in module. Use "node:${name}" to restrict it.`
            });
          }
        }
        if (!valid()) {
          break;
        }
        const packages = new Set(rule.packages);
        const builtins = rule.packages.filter((name) => name.startsWith(NODE_PREFIX));
        const restrictedName = (item: FileImport): string | undefined => {
          if (item.resolution === "external-package") {
            return item.externalPackage !== undefined && packages.has(item.externalPackage)
              ? item.externalPackage
              : undefined;
          }
          if (item.resolution !== "node-built-in") {
            return undefined;
          }
          const specifier = item.specifier.replace(/^node:/u, "");
          return builtins.find((name) => {
            const module = name.slice(NODE_PREFIX.length);
            return specifier === module || specifier.startsWith(`${module}/`);
          });
        };
        const includeImport = createImportFilter(filtersFor(rule.scope));
        const violations = new Map<
          string,
          { componentId: string; packageName: string; imports: string[] }
        >();
        for (const item of snapshot.fileImports) {
          const packageName = restrictedName(item);
          if (packageName === undefined) {
            continue;
          }
          const file = filesById.get(item.fromFileId);
          if (!file || allowed.has(file.componentId) || !includeImport(item, file)) {
            continue;
          }
          const key = canonicalJson([file.componentId, packageName]);
          const group = violations.get(key) ?? {
            componentId: file.componentId,
            packageName,
            imports: []
          };
          group.imports.push(item.id);
          violations.set(key, group);
        }
        for (const { componentId, packageName, imports } of violations.values()) {
          addFinding(
            { kind: "external-package", componentId, packageName },
            `${name(componentId)} is not allowed to import "${packageName}".`,
            imports
          );
        }
        break;
      }
      case "no-cycles": {
        const componentIds =
          rule.components === undefined
            ? undefined
            : selectors.withDescendants(select(rule.components, "components"));
        if (!valid()) {
          break;
        }
        for (const cycle of collectCycleSupport(
          depths,
          (depth) => graphAt(depth, rule.scope),
          parentById,
          {
            componentIds,
            includeTypeOnlyCycles: rule.includeTypeOnlyCycles
          }
        )) {
          const shown = cycle.memberIds.slice(0, MESSAGE_MEMBER_LIMIT).map(name).join("; ");
          const hidden = cycle.memberIds.length - MESSAGE_MEMBER_LIMIT;
          addFinding(
            { kind: "components", componentIds: cycle.memberIds },
            `Dependency cycle involving ${shown}${hidden > 0 ? ` and ${hidden} more` : ""}.`,
            cycle.imports
          );
        }
        break;
      }
    }
  }

  return {
    schemaVersion: RULE_EVALUATION_SCHEMA_VERSION,
    governanceEngineVersion,
    rulesHash: computeRulesHash(rules),
    contentHash: snapshot.contentHash,
    analysisConfigHash: snapshot.analysisConfigHash,
    createdAt: snapshot.createdAt,
    findings: findings.sort(
      (a, b) => compareStrings(a.ruleId, b.ruleId) || compareStrings(a.fingerprint, b.fingerprint)
    ),
    diagnostics: diagnostics.sort(
      (a, b) =>
        compareStrings(a.ruleId, b.ruleId) ||
        compareStrings(a.field ?? "", b.field ?? "") ||
        compareStrings(a.message, b.message)
    )
  };
}
