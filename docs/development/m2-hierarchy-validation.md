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

### ArchMind: name the bounded context

Expanding `apps/api` shows the generic `modules` folder by default. With `src/modules` as the root, `architecture-model` is the child and owns `explorer.service.ts`. Its edge to `contracts` shows both static and type-only evidence, including `explorer.controller.ts:1` for the static `@archmind/contracts` import. The edge count is unchanged; the override improves attribution. No files under `apps/cli/fixtures/` were present.

### Vitest: a deeper root trades breadth for detail

The default `packages/vitest` hierarchy already separates `node`, `runtime`, `public`, and six other children, but `node` does not expose its subareas. Rooting at `src/node` exposes `reporters`, `pools`, `sequencers`, and other children. It also removes `runtime` as a child: `src/runtime/benchmark.ts` now belongs directly to `packages/vitest`. Keep the default for a package-wide view; use this override for a Node-internals investigation. The rest of the repository still includes fixture neighborhoods such as `test/e2e/fixtures`, and the default has four children named `node` across different packages. Path search and the component list disambiguate them.

Neither view can show an internal edge for `vitest/config` from `examples/in-source-test/vitest.config.ts:1`: it is one of 582 `WORKSPACE_ENTRY_UNMAPPED` warnings. The snapshot also reports 22 `IMPORT_TARGET_EXCLUDED` warnings, including a target at `packages/browser/context.d.ts`, and a separate unresolved rate of 0.99%. These are resolution or input-coverage gaps, not evidence that the hierarchy removed edges.

### Changesets: commands are useful components for a focused view

The default `packages/cli` hierarchy groups all CLI commands under `commands`, alongside `commit`, `lib`, `ponyfills`, and `utils`. The override exposes nine command components, including `version` and `publish`. The `version` component's edge to `apply-release-plan` points to the static import at `packages/cli/src/commands/version/index.ts:3`; file drill-down shows that file in the graph. The trade-off is that the former sibling folders roll up to `packages/cli`. The tuned view also has two `pre` labels: `packages/pre` and `packages/cli/src/commands/pre`.

The overview shows six diagnostics despite a 0% unresolved rate: two `TSCONFIG_PARSE_ERROR`, two missing package-based tsconfig extends in the source-only checkout, and two unmapped `@changesets/cli/package.json` self-imports. The manifest imports are not TypeScript component edges; a zero unresolved rate is not a guarantee of complete graph coverage.

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

Build the API and web app with `pnpm build --filter=@archmind/api --filter=@archmind/web`, then start each in its own terminal:

```bash
ARCHMIND_SNAPSHOT_DIR="$study/snapshots" PORT=3921 node apps/api/dist/main.js
ARCHMIND_API_ORIGIN=http://127.0.0.1:3921 pnpm --filter @archmind/web start --port 3920
```

In the explorer at `http://127.0.0.1:3920`, select each snapshot and check **Snapshot overview**, expand the target package, search by child path, then open its details from **Show component list** using Enter. For tuned ArchMind and Changesets, inspect the edges named above; for Changesets also open the `version` file graph and return to the component graph. All six journeys passed in headless Chromium `159.0.8154.6` at 1440 × 900. This was an interaction check, not a usability study or a performance benchmark.

See the [backlog follow-ups](../BACKLOG.md#follow-ups-from-real-repository-validation) for hierarchy granularity, fixture noise, ambiguous labels, and missing-edge explanations.
