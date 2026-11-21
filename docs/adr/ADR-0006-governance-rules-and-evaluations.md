# ADR-0006: Governance rules and evaluations

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

ArchMind snapshots describe the analysed repository independently of its governance policy. Teams need to apply and revise rules without re-analysing source, and compare findings across snapshots without rewriting either result.

## Problem

Define the rule configuration and evaluation contract, including how selectors address hierarchical components, how rules use the dependency graph, and how findings retain stable identities across evaluations.

## Considered alternatives

1. Store findings in the snapshot. This would tie snapshot identity to policy changes and governance engine upgrades.
2. Evaluate rules on demand without saving results. This would make it harder to retain a baseline and reproduce what a previous check reported.
3. Store separate immutable evaluations that reference the snapshot by content hash.

## Decision

### Rule configuration and selectors

- `rules` is an optional object with `definitions` (custom rules) and `disableDefaults` (reserved IDs). Both lists default to empty. Every custom rule has a unique `id`, `type` and `severity` (`error` or `warning`). Reserve the `archmind/` prefix; initially the built-in IDs are `archmind/no-cycles` and `archmind/high-coupling`. They remain enabled unless explicitly disabled by ID. Unknown IDs in `disableDefaults` are errors.
- Selectors are explicit objects with exactly one field: `{ "path": "apps/api/src/modules/*" }` or `{ "name": "payments" }`. Paths are repository-relative POSIX component paths, not file paths. Globs use the same matching conventions as `analysis.exclude` (case-sensitive, match dotfiles, no leading negation or comment interpretation). Names match exact configured component names, never inferred names or display names. A match includes the selected component and its descendants in the snapshot hierarchy, even when a configured parent and child have unrelated paths. A selector that matches nothing produces a diagnostic and does not make the affected rule silently pass.
- `layers` declares named layers in order from highest to lowest, with selectors for each layer. A layer may depend on **any** lower layer, not just the next one. Dependencies within one layer are allowed, and dependencies involving unassigned components are not checked by this rule. If a component inherits multiple assignments, the nearest matched ancestor (or the component itself) wins. Equal-specificity assignments to different layers produce a diagnostic and the ambiguous rule is not evaluated.
- `forbidden-dependency` checks imports from components matched by `from` to components matched by `to`. `restricted-package` checks exact external package names (including scoped names and imports from package subpaths) and allows only the listed component selectors; an empty allowlist forbids all imports of those packages. Neither rule treats unresolved imports as edges.
- `no-cycles` may restrict the graph to selected components and descendants; both endpoints must be in scope. `threshold` checks whether a stored metric of each selected component exceeds a maximum. It has no scope options and does not recalculate metrics.
- Dependency and cycle rules may add file roles to `source` and exclude type-only imports. The role filter applies to the importing file. Cycle rules ignore SCCs classified as `typeOnly` by the shared cycle logic by default.

### Cycle reporting and high coupling

- A cycle finding represents a strongly connected component (SCC) in a component projection, not every possible circuit within it. Use the shared projector and cycle detection at each hierarchy depth, not the file graph. Never discard a coarser SCC just because some of its members have a finer cycle: a cycle can exist only after roll-up.
- To avoid duplicate findings, compare SCCs from deepest to shallowest. A previously kept finer SCC subsumes a coarser SCC only if its members project onto the same coarser member set and its supporting imports cover every import that contributes to the coarser SCC's internal projected edges. Compare support before truncating evidence. Keep coarse-only and partially overlapping SCCs. This also works when `nestedFolders` introduces another depth without changing the cycle's support.
- `archmind/no-cycles` reports errors; `archmind/high-coupling` reports warnings. Use stored production-graph `fanOut` for high coupling: it counts distinct outgoing internal component dependencies, not import volume. Start with a provisional maximum of 10 (warn above 10). M3.6 must calibrate and record the final default using ArchMind, Vitest and Changesets.

### Hashes, validation and findings

- Validate the config root strictly, but validate `analysis` and `rules` separately. `archmind analyze` validates only the root and `analysis`; a malformed `rules` value does not stop it. Governance validation uses Zod in `contracts` and reports the rule ID (or its array position if no usable ID is present) and field for rule-specific errors.
- Compute `rulesHash` from the canonical JSON of the parsed, normalised `rules` object. Omission and empty configuration have the same hash. Use code-unit ordering for unordered lists (rule definitions by ID, disabled IDs, selector lists, package names and file roles); preserve layer order because it has meaning. Only the normalised rule configuration is hashed, not the engine version or built-in definitions. Rules never affect `sourceHash`, `analysisConfigHash` or snapshot `contentHash`.
- An evaluation is a separate immutable document with `schemaVersion`, `governanceEngineVersion`, `rulesHash`, the snapshot's `contentHash` and `analysisConfigHash`, `createdAt`, findings and rule diagnostics. Its identity is `(contentHash, rulesHash, governanceEngineVersion)`; timestamps and filenames are metadata. `schemaVersion` describes the persisted format. Bump `governanceEngineVersion` when evaluation semantics or built-in rules change. Derive each custom rule's `ruleVersion` from a hash of its normalised definition; built-ins use a revision that changes when their definition changes. No user-maintained version field is required.
- A finding records the rule ID and version, severity, message, subject, evidence, total evidence count and fingerprint. Subjects identify components, directed component endpoints, or an importing component and external package. Evidence uses the explorer's compact import shape. Sort distinct evidence by `filePath`, `line`, `column`, `specifier`, `kind` and `role`, then retain at most **20** items per finding. Record the uncapped distinct count; findings based only on stored metrics may have no import evidence.
- Fingerprints include the rule ID and stable subject keys, but not the rule version, line numbers, timestamps or config order. Renaming a rule changes its findings' identities. Comparing two immutable evaluations derives new, existing and resolved findings by fingerprint and flags changes to `rulesHash` and `analysisConfigHash`.

## Consequences

- Policy changes and governance engine upgrades can reuse an existing snapshot. Invalid governance configuration cannot block or invalidate analysis.
- Hierarchy changes can change the scope of rules and subjects of findings; the baseline comparison exposes that separately from rule changes.
- Graph coverage limits still apply. An import resolved only to a workspace package cannot be checked against a selector for a folder inside that package. Unresolved and excluded imports are not checked.
