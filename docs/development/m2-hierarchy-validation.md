# M2.7: Hierarchy validation on real repositories

## Setup

Ran ArchMind at `318eefd04e99ae0afa1e3443ebe6e83059cc55a0` on macOS arm64 (Apple M4), with Node `24.22.3` and pnpm `10.19.0`. Used isolated source checkouts with no dependency installs or builds in the targets. Vitest's checked-in fixtures, including directories named `node_modules`, were left as tracked. The upstream revisions match the [M1 resolution benchmark](./m1-resolution-benchmark.md).

| Target                  | Revision                                   | Default configuration                      | Tuned `analysis.componentRoots`  |
| ----------------------- | ------------------------------------------ | ------------------------------------------ | -------------------------------- |
| ArchMind                | `318eefd04e99ae0afa1e3443ebe6e83059cc55a0` | Only `analysis.exclude` from self-analysis | `"apps/api": "src/modules"`      |
| `vitest-dev/vitest`     | `efba8cbfe94b1402a7ccab8a73994cb389cffa4d` | No `archmind.config.json`                  | `"packages/vitest": "src/node"`  |
| `changesets/changesets` | `9a035ec36045aeb6141dd0bbac9ab9e3c69ac0bc` | No `archmind.config.json`                  | `"packages/cli": "src/commands"` |

ArchMind retains `analysis.exclude: ["apps/cli/fixtures/**"]` in both runs to isolate hierarchy changes. Only the config was edited in the scratch checkouts; a snapshot can therefore report a dirty worktree even though the revision's source files are unchanged. No upstream config changes are proposed.

## Results

Arrows compare default to tuned. Stored counts describe the whole snapshot; visible edges were counted in the browser with only the target package expanded, source imports selected and type-only imports included.

| Target     | Files | File imports | Components | Target children | Stored component dependencies | Visible internal edges | Diagnostics |
| ---------- | ----: | -----------: | ---------: | --------------: | ----------------------------: | ---------------------: | ----------: |
| ArchMind   |   101 |          376 |    15 → 15 |           1 → 1 |                       24 → 24 |                18 → 18 |           0 |
| Vitest     | 2,430 |        6,903 |  101 → 104 |          9 → 12 |                     295 → 262 |                48 → 45 |         611 |
| Changesets |   164 |          741 |    37 → 41 |           5 → 9 |                     108 → 173 |                64 → 87 |           6 |

Each pair had identical files and file imports after excluding component IDs from the comparison, and identical resolution statistics and diagnostics. Changing ownership can split one aggregate edge into several, or merge edges back into a parent. It does not repair unresolved imports.

The stored and visible counts come from different runs and different checks. The stored counts are traced below. The visible edge counts were read in the browser during the M2.7 run and were not re-derived; treat them as observations.

### Tracing the edge-count changes

A re-run at the same revisions (see [Reproduce the comparison](#reproduce-the-comparison)) diffed the stored dependency sets of the default and tuned snapshots, keyed by the component paths at each end. Every changed edge has the tuned package at one end, and no edge elsewhere in the repository changed.

| Target     | Default | Tuned | Unchanged | Only in default | Only in tuned | Import weight, default to tuned |
| ---------- | ------: | ----: | --------: | --------------: | ------------: | ------------------------------: |
| Vitest     |     295 |   262 |       157 |             138 |           105 |                   3,274 → 3,197 |
| Changesets |     108 |   173 |        80 |              28 |            93 |                       277 → 289 |

- **Changesets, split.** One default edge `commands → packages/types` (12 imports, for example `packages/cli/src/commands/add/createChangeset.ts` importing `packages/types/src/index.ts`) becomes one edge per command component, such as `commands/add → packages/types` and `commands/status → packages/types`. The 9 command components multiply the edges that used to leave `commands`, so the count rises from 108 to 173.
- **Changesets, merge.** The folders `commit`, `lib`, `ponyfills` and `utils` are no longer components, because the component root moved to `src/commands`. Their 26 files belong to `packages/cli`, so an edge such as `commit → packages/types` (3 imports) is now `packages/cli → packages/types`.
- **Vitest, merge.** Rooting at `src/node` removes all nine folders under `src` as components: `node` itself, whose 29 direct files now belong to the package, and its eight siblings (`runtime` with 71 files, `utils` 22, `integrations` 26, `types` 11, `public` 6, `typecheck` 5, `create` 2, `api` 3). Edges such as `runtime → packages/snapshot` (3 imports) and `runtime → packages/mocker` (6) become `packages/vitest → …`, and `test/workspaces → public` (14 imports) becomes an edge into the package. This is why the stored count falls from 295 to 262, and why the import weight falls: imports between the former siblings are now inside one component and no longer count as dependencies.
- **Vitest, split.** Imports inside the single `node` component were not dependencies. They now run between `node/config`, `node/plugins`, `node/reporters` and the others (for example `node/config → node/reporters`, 1 import), which adds edges.

The earlier explanation, that ownership changes split or merge aggregate edges, was inferred. It is now confirmed by these examples.

### Diagnostics were sampled, not counted

The M2.7 browser check read only the first page of diagnostics (50 of Vitest's 611). The totals in this report come from the snapshot JSON instead, and the snapshot overview now lists the count for every diagnostic code across all pages.

| Target     | Diagnostics | By code                                                                                                                        |
| ---------- | ----------: | ------------------------------------------------------------------------------------------------------------------------------ |
| Vitest     |         611 | `WORKSPACE_ENTRY_UNMAPPED` 582, `IMPORT_TARGET_EXCLUDED` 22, `SOURCE_FILE_PARSE_ERROR` 6, `WORKSPACE_PACKAGE_NAME_DUPLICATE` 1 |
| Changesets |           6 | `TSCONFIG_PARSE_ERROR` 2, `TSCONFIG_EXTENDS_UNRESOLVED_PACKAGE_SKIPPED` 2, `WORKSPACE_ENTRY_UNMAPPED` 2                        |

The first version of this report did not mention the six Vitest parse errors (intentional unparsable fixtures such as `test/e2e/deps/optimizer/unparsable/index.js`) or the duplicate package name (`@vitest/test-integration-dts-exact-optional-property` is declared by three fixture packages). Of the 582 unmapped Vitest entries, 223 are `vitest/config`, 171 `vitest/node` and 114 `vitest/browser`, which are exports of the `vitest` package that point at build output. Four are non-code subpaths such as `vitest/package.json`. The two Changesets entries are `@changesets/cli/package.json`.

### ArchMind: name the bounded context

Expanding `apps/api` shows the generic `modules` folder by default. With `src/modules` as the root, `architecture-model` is the child and owns `explorer.service.ts`. Its edge to `contracts` shows both static and type-only evidence, including `explorer.controller.ts:1` for the static `@archmind/contracts` import. The edge count is unchanged; the override improves attribution. No files under `apps/cli/fixtures/` were present.

### Vitest: a deeper root trades breadth for detail

The default `packages/vitest` hierarchy already separates `node`, `runtime`, `public`, and six other children, but `node` does not expose its subareas. Rooting at `src/node` exposes `reporters`, `pools`, `sequencers`, and other children. It also removes `runtime` as a child: `src/runtime/benchmark.ts` now belongs directly to `packages/vitest`. Keep the default for a package-wide view. `analysis.nestedFolders` is now the better way to look at Node internals: see [Keeping siblings while going deeper](#keeping-siblings-while-going-deeper). The default has four components named `node` across different packages; the explorer now qualifies repeated names with their path, in graph nodes, edge labels and evidence buttons.

Neither view can show an internal edge for `vitest/config` from `examples/in-source-test/vitest.config.ts:1`: it is one of 582 `WORKSPACE_ENTRY_UNMAPPED` warnings. The snapshot also reports 22 `IMPORT_TARGET_EXCLUDED` warnings, including a target at `packages/browser/context.d.ts`, and a separate unresolved rate of 0.99%. These are resolution or input-coverage gaps, not evidence that the hierarchy removed edges.

### Changesets: commands are useful components for a focused view

The default `packages/cli` hierarchy groups all CLI commands under `commands`, alongside `commit`, `lib`, `ponyfills`, and `utils`. The override exposes nine command components, including `version` and `publish`. The `version` component's edge to `apply-release-plan` points to the static import at `packages/cli/src/commands/version/index.ts:3`; file drill-down shows that file in the graph. The trade-off is that the former sibling folders roll up to `packages/cli`. The tuned view also has two components named `pre`, `packages/pre` and `packages/cli/src/commands/pre`; the explorer now shows them as `pre (packages/pre)` and `pre (packages/cli/src/commands/pre)`.

The overview shows six diagnostics despite a 0% unresolved rate: two `TSCONFIG_PARSE_ERROR`, two missing package-based tsconfig extends in the source-only checkout, and two unmapped `@changesets/cli/package.json` self-imports. The manifest imports are not TypeScript component edges; a zero unresolved rate is not a guarantee of complete graph coverage.

### Keeping siblings while going deeper

Because `componentRoots` removes siblings, [ADR-0005](../adr/ADR-0005-hierarchical-hybrid-component-model-and-file-roles.md#addendum-2026-11-20-nested-folder-components) gained `analysis.nestedFolders`. It adds child components under a listed folder and keeps every other folder. The same snapshots were generated with `nestedFolders` instead of `componentRoots`:

| Target     | Setting under `analysis`                         | Components (default → nested) | Stored dependencies (default → nested) |
| ---------- | ------------------------------------------------ | ----------------------------: | -------------------------------------: |
| Vitest     | `"nestedFolders": ["packages/vitest/src/node"]`  |                     101 → 113 |                              295 → 416 |
| Changesets | `"nestedFolders": ["packages/cli/src/commands"]` |                       37 → 46 |                              108 → 193 |

Vitest keeps `runtime` and its other siblings and adds twelve children under `node`, including `node/reporters`, `node/pools` and `node/plugins`. Changesets keeps `lib`, `commit`, `utils` and `ponyfills` and adds nine command components under `commands`. Files, imports and diagnostics are unchanged. Against the default, 14 Vitest and 16 Changesets edges exist only there, because they ran from the folder that is now split (`node → packages/types` becomes `node/config → packages/types` and similar). All of them touch the listed folder's package. The higher edge counts come from the finer view; the imports are unchanged.

### Other overrides

- **Changesets `docs`.** No override is needed. The package has 8 files, in single-file folders (`blog`, `guide`, `packages`, `scripts`) and `.vitepress`, which the default already shows as children.
- **Vitest `test/e2e`.** `test/e2e` is one package with 827 files; `fixtures` (529), `test` (180) and `snapshots` (85) are its main children. Splitting it further would not help the production view, because every file in those folders has the `test` role. The fixture noise is handled in the explorer instead; see below.

### Fixture noise in the production view

With only the `source` role selected, Vitest's default depth-1 view showed 43 components, 20 of which have no source file: `test/e2e` (827 files), `test/unit` (343), `test/browser` (319), `test/coverage-test` (187) and the `test/e2e/dts/*` fixture packages. Their edges were already filtered out, so the components were nodes without edges. The explorer now hides a component when none of its files has a selected role, unless a shown dependency ends at it. The count falls to 23 with the same 31 dependencies. Changesets goes from 26 to 23. Selecting the `test` role, or **Show components without files in these roles**, brings them back (42 components and 84 dependencies for Vitest with `source` and `test`). The explorer API takes `includeEmptyComponents=false` for this. A repository that does not want such directories at all can still use `analysis.exclude`.

## Reproduce the comparison

From the ArchMind implementation checkout, prepare scratch checkouts at the revisions above. Name them `archmind`, `vitest`, and `changesets`; the scratch area should be outside the implementation checkout. Set `study` to its absolute path and create a `snapshots` directory there. Generate the default snapshots using the default configs in the table:

```bash
for repo in archmind vitest changesets; do
  pnpm archmind analyze "$study/$repo" --out "$study/snapshots/$repo-default.json"
done
```

In the scratch checkouts only, add the listed `componentRoots` mapping under `analysis` for each repo. Keep ArchMind's exclusion. Generate the tuned snapshots:

```bash
for repo in archmind vitest changesets; do
  pnpm archmind analyze "$study/$repo" --out "$study/snapshots/$repo-tuned.json"
done
```

For the sibling-preserving view, generate a third snapshot per repository with `"nestedFolders": ["packages/vitest/src/node"]` or `["packages/cli/src/commands"]` in place of `componentRoots`. To trace the edge counts, compare the default and tuned `dependencies` arrays, using each component's `paths[0]` as the key for its two ends.

Build the API and web app with `pnpm build --filter=@archmind/api --filter=@archmind/web`, then start each in its own terminal:

```bash
ARCHMIND_SNAPSHOT_DIR="$study/snapshots" PORT=3921 node apps/api/dist/main.js
ARCHMIND_API_ORIGIN=http://127.0.0.1:3921 pnpm --filter @archmind/web start --port 3920
```

In the explorer at `http://127.0.0.1:3920`, select each snapshot and check **Snapshot overview**, expand the target package, search by child path, then open its details from **Show component list** using Enter. For tuned ArchMind and Changesets, inspect the edges named above; for Changesets also open the `version` file graph and return to the component graph. All six journeys passed in headless Chromium `159.0.8154.6` at 1440 × 900. This was an interaction check, not a usability study or a performance benchmark.

The [backlog](../BACKLOG.md#follow-ups-from-real-repository-validation) records how each follow-up from this validation was resolved.
