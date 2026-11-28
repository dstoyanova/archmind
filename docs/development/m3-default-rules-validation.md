# M3.6: Default rule validation on real repositories

## Setup

Ran the ArchMind implementation at `95a7fa9` (M3.1 to M3.5 and the M3 review items) on macOS arm64 (Apple M4), with Node `24.22.3` and pnpm `10.19.0`. The targets are the [M2.7](./m2-hierarchy-validation.md) revisions, as isolated source checkouts with no dependency installs or builds. Only the default rules ran: no `rules` section was configured anywhere.

| Target                  | Revision                                   | Configuration                                                                |
| ----------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| ArchMind                | `318eefd04e99ae0afa1e3443ebe6e83059cc55a0` | Its self-analysis config at that revision (`componentRoots` for `apps/api`)  |
| `vitest-dev/vitest`     | `efba8cbfe94b1402a7ccab8a73994cb389cffa4d` | None (default hierarchy), and `nestedFolders: ["packages/vitest/src/node"]`  |
| `changesets/changesets` | `9a035ec36045aeb6141dd0bbac9ab9e3c69ac0bc` | None (default hierarchy), and `nestedFolders: ["packages/cli/src/commands"]` |

ArchMind's checkout is a `git archive` of the revision, because `archmind check` did not exist then. The `nestedFolders` runs add a third hierarchy level, so the calibration sees parents and children. `componentRoots` is not repeated: it removes siblings and was superseded by `nestedFolders` in the M2.7 follow-ups. Snapshots from the three repositories give five hierarchies: 15, 101, 113, 37 and 46 components.

The first run used engine `0.2.0`, where `archmind/high-coupling` applies at every depth. After the calibration the rule is leaf-only in engine `0.3.0` (see [Decision](#decision)). Both sets of numbers are below.

All labels (useful, noise, coverage gap) are one reviewer's judgement from the evidence, not a maintainer review.

## Results

`archmind check <repo> --snapshot <snapshot>` with each snapshot's analysis coverage:

| Hierarchy           | Components | Leaves | `no-cycles` errors | `high-coupling` warnings, 0.2.0 → 0.3.0 | Unresolved rate | Diagnostics |
| ------------------- | ---------: | -----: | -----------------: | --------------------------------------: | --------------: | ----------: |
| ArchMind            |         15 |     12 |                  0 |                                   0 → 0 |           0.00% |           0 |
| Vitest, default     |        101 |     80 |                  4 |                                   3 → 3 |           0.99% |         611 |
| Vitest, nested      |        113 |     91 |                  4 |                                   5 → 4 |           0.99% |         611 |
| Changesets, default |         37 |     33 |                  0 |                                   2 → 1 |           0.00% |           6 |
| Changesets, nested  |         46 |     41 |                  1 |                                   3 → 1 |           0.00% |           6 |

ArchMind at the current checkout also has 0 findings, which is what CI checks. Type-only and test-only cycles produced no default findings. Changesets' default hierarchy has a `commands` ↔ `lib` loop whose only back edge is the type-only import at `packages/cli/src/lib/types.ts:2`, and that is correctly not reported.

## Calibrating `archmind/high-coupling`

### `fanOut` is not comparable across depths

A component's `fanOut` counts distinct targets in the view at its own depth, so deeper components see finer targets. Stored values by depth:

| Hierarchy           | Depth | Components | Median | p90 | Max |
| ------------------- | ----: | ---------: | -----: | --: | --: |
| ArchMind            |     1 |         10 |      2 |   4 |   4 |
| ArchMind            |     2 |          4 |      2 |   3 |   3 |
| Vitest, default     |     1 |         42 |      0 |   2 |   7 |
| Vitest, default     |     2 |         58 |      0 |   8 |  16 |
| Vitest, nested      |     3 |         12 |      8 |  12 |  18 |
| Changesets, default |     1 |         25 |      1 |   4 |  13 |
| Changesets, default |     2 |         11 |      1 |   7 |  15 |
| Changesets, nested  |     3 |          9 |      8 |  13 |  13 |

Every depth-1 component in Vitest is at 7 or less, and the depth-3 median is 8. The same number means different things at different depths.

### Nested duplicates

A parent's `fanOut` is mostly its children's targets, collapsed to the parent's view. At the provisional maximum of 10 (engine `0.2.0`, every depth), the parents below were flagged together with a flagged descendant. The last column is how many of the parent's targets come from that descendant:

| Hierarchy           | Parent (`fanOut`)                | Flagged descendant (`fanOut`)            | Shared targets |
| ------------------- | -------------------------------- | ---------------------------------------- | -------------- |
| Changesets, default | `packages/cli` (13)              | `packages/cli/src/commands` (15)         | 12 of 13       |
| Vitest, nested      | `packages/vitest/src/node` (16)  | `packages/vitest/src/node/config` (12)   | 5 of 16        |
| Vitest, nested      | `packages/vitest/src/node` (16)  | `packages/vitest/src/node/types` (18)    | 10 of 16       |
| Changesets, nested  | `packages/cli/src/commands` (15) | `packages/cli/src/commands/version` (13) | 12 of 15       |
| Changesets, nested  | `packages/cli` (13)              | `packages/cli/src/commands/version` (13) | 10 of 13       |
| Changesets, nested  | `packages/cli` (13)              | `packages/cli/src/commands` (15)         | 12 of 13       |

Counting findings, the 13 high-coupling warnings across the five hierarchies include **4 nested duplicates (31%)**: `packages/cli` in Changesets' default hierarchy, `packages/vitest/src/node` in Vitest's nested one, and `packages/cli/src/commands` and `packages/cli` in Changesets' nested one. In the default hierarchies alone, 1 of 5 findings is a duplicate; in the nested ones, 3 of 8. A deeper hierarchy produces more duplicates.

No flagged non-leaf component lacked a flagged descendant, at any maximum from 5 to 15, in any of the five hierarchies. Restricting the rule to leaves therefore loses no location, and removes the 4 duplicates.

### Threshold sweep

Findings for `fanOut` above each maximum, as every depth / leaf only. ArchMind has none at any value (its highest `fanOut` is 4).

| Maximum | Vitest, default | Vitest, nested | Changesets, default | Changesets, nested |
| ------: | --------------: | -------------: | ------------------: | -----------------: |
|       5 |         11 / 10 |        20 / 18 |               3 / 2 |             10 / 8 |
|       8 |           5 / 5 |          8 / 7 |               2 / 1 |              6 / 4 |
|  **10** |       **3 / 3** |      **5 / 4** |           **2 / 1** |          **3 / 1** |
|      12 |           3 / 3 |          4 / 3 |               2 / 1 |              3 / 1 |
|      15 |           1 / 1 |          2 / 1 |               0 / 0 |              0 / 0 |

At 10, leaf-only flags 9 of 257 leaves (3.5%). The default hierarchies are stable from 10 to 12 and fall away below 8, where Vitest's depth-2 p90 starts to count.

### Findings traced to evidence

A `high-coupling` finding has no evidence of its own (`evidenceTotal` is 0), so each one was traced through the snapshot: the target components and one import per target, checked against the source file. The leaf-only findings, with evidence from the traced imports:

| Finding                                                | `fanOut` | Evidence                                                                                                                                                                   | Label                                             |
| ------------------------------------------------------ | -------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Vitest `packages/vitest/src/node`                      |       16 | 120 files. 73 imports into `utils`, 42 into `runtime`, and edges such as `watch-filter.ts:6` (`../utils/base`) and a dynamic `@vitest/ui` import at `plugins/index.ts:78`. | Useful: the largest hub in the package.           |
| Vitest `packages/vitest/src/runtime`                   |       13 | 71 files. For example `workers/init.ts:1` imports `../../node/pools/types`, one of the edges that ties `runtime` to `node` in the 12-member cycle.                         | Useful.                                           |
| Vitest `packages/vitest/src/public`                    |       13 | 6 files that re-export the public API, such as `public/index.ts:32` (`../integrations/chai`).                                                                              | Noise: a facade is expected to be wide.           |
| Changesets `packages/cli/src/commands`                 |       15 | One import per package from the command folders, such as `version/index.ts:5` (`@changesets/color`).                                                                       | Noise: the layer that wires commands.             |
| Vitest, nested `packages/vitest/src/node/config`       |       12 | `resolveConfig.ts` imports plugins, sequencers, reporters and projects statically (`:31`, `:38`, `:36`, `:35`).                                                            | Useful: configuration depends on behaviour.       |
| Vitest, nested `packages/vitest/src/node/types`        |       18 | 9 files, and every one of the traced imports is type-only (`browser.ts:18`, `reporter.ts:2`).                                                                              | Noise: type declarations name what they describe. |
| Changesets, nested `packages/cli/src/commands/version` |       13 | One file, `version/index.ts`, with one import per package (`:3` to `:12`).                                                                                                 | Noise: an orchestrating command.                  |

3 of 7 are useful. The noise sits at 12 to 18, interleaved with the useful findings: a facade at 13 next to a useful `runtime` at 13, a useful `node` at 16 next to a noisy `commands` at 15. No maximum separates them, so raising the threshold would only trade useful findings for fewer noisy ones. Keep 10 for the default; the severity is `warning`, so `--fail-on error` does not fail on it.

## Decision

- **Maximum stays at 10.** It flags a few percent of leaves, nothing in ArchMind, and sits on a plateau (10 to 12) in the default hierarchies. A higher maximum drops useful findings (`runtime`, `config`) together with noise, because both kinds share values: 13 for `public` (noise) and `runtime` (useful).
- **`archmind/high-coupling` applies to leaf components only.** It removes the 4 nested duplicates and loses no location. The rule version becomes `2` and the engine version `0.3.0`. A custom `threshold` rule still applies to every component its selectors match. The trade-off is that the result depends on the hierarchy: a folder that `nestedFolders` splits is no longer reported as a whole, only its children are.

[ADR-0006](../adr/ADR-0006-governance-rules-and-evaluations.md#2026-11-28) records the decision.

## `no-cycles` findings traced

| Finding                                                         | Evidence                                                                                                                                                                                     | Label                                                                                                            |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Vitest `packages/vitest`, `packages/ui`, `packages/expect`      | 55 imports. `packages/expect/src/jest-expect.ts:3` and `jest-extend.ts:1` import `../../vitest/src/runtime/runner/types` by relative path. A 28-file file cycle runs through it.             | Useful: a package boundary crossed by path.                                                                      |
| Vitest, 12 members (498 imports)                                | `runtime`, `node`, `vitest`, `ui`, `types` and 7 more. Two non-type-only file cycles (98 and 28 files) span its members.                                                                     | Useful, hard to act on: the message names 5 members and 20 of 498 imports are kept.                              |
| Vitest `packages/utils/src/diff`, `packages/utils`              | `diff/index.ts:14` imports `../display` and `error.ts:4` imports `./diff`. The files do not form a cycle.                                                                                    | Noise: a package and its own folder, with no file-level cycle.                                                   |
| Vitest `packages/pretty-format`, `…/src/plugins`                | `index.ts:26` imports the plugins and `plugins/*.ts:8` import `../types`. No file-level cycle.                                                                                               | Noise: the same pattern.                                                                                         |
| Changesets, nested: `publish`, `git-tag`, `publish-plan`, `lib` | `publish/index.ts:18` imports `publish-plan/getPublishPlan.ts`, which imports `publish/getPublishTool.ts:21`. `lib/types.ts:2` and `git-tag/utils.ts:6` close loops through type-only edges. | Useful: `publish` ↔ `publish-plan` is a real static loop. `git-tag` and `lib` join only through type-only edges. |

3 of 5 are useful. Two of the 4 Vitest findings (and 2 of 5 overall) are a component paired with its own descendant that share no file-level cycle.

## Coverage gaps

- **Unmapped workspace entries.** Vitest reports 582 `WORKSPACE_ENTRY_UNMAPPED`: 435 are in test files and 6 in config files, so they are outside the production graph the default rules use. The other 141 are in source files. Of those, 124 cross package boundaries (`vitest/node` 40, `vitest/browser` 35, `@vitest/browser` 18, `vitest/internal/browser` 17), and every one of the 12 package pairs they connect already has an edge from other, resolved imports. They therefore change no package-level `fanOut` and close no package-level cycle. Below package level they are invisible, because a `vitest/*` export points at build output and cannot be mapped to a folder. This is a **coverage gap** for folders in other packages: `packages/browser/src/node` has `fanOut` 10, exactly at the maximum, and imports five distinct unmapped entries (`vitest/node`, `vitest/browser`, `@vitest/browser`, `@vitest/ui`, `vitest/config`), so it could be a finding. `packages/browser/src/client` (7) has five more.
- **Changesets** has two unmapped entries, both `@changesets/cli/package.json` (a manifest, not code). Not a gap.
- **Reported by design, not a gap.** The default rules compare components. Vitest has two file cycles that stay inside one component (15 files in `packages/ui` and 2 in `integrations`) and are never reported. The six `SOURCE_FILE_PARSE_ERROR` files are intentional fixtures, and the 22 `IMPORT_TARGET_EXCLUDED` imports are known exclusions.

## Follow-ups

Not done in M3.6. Each is a change to rule behaviour or the resolver, and would change the engine version.

- Name the targets, or the heaviest imports, in a `high-coupling` finding. Today it has no evidence and has to be traced through the snapshot.
- Decide whether a cycle between a component and its own descendant needs a file-level cycle to be reported (2 of 5 traced cycles).
- Decide whether a cycle's member list should include components that join only through type-only edges (Changesets' `git-tag` and `lib`).
- Map `vitest/*`-style workspace exports to their source folders, so imports into a package's folders are counted below package level.

## Reproduce the validation

Prepare scratch checkouts outside the implementation checkout and set `study` to their parent directory. At the revisions above:

```bash
study=/tmp/archmind-m36
mkdir -p "$study/snapshots" "$study/archmind" "$study/vitest" "$study/changesets"

# In the implementation checkout:
git archive 318eefd04e99ae0afa1e3443ebe6e83059cc55a0 | tar -x -C "$study/archmind"

fetch_at() {
  git -C "$1" init -q
  git -C "$1" fetch -q --depth 1 "$2" "$3"
  git -C "$1" checkout -q FETCH_HEAD
}
fetch_at "$study/vitest" https://github.com/vitest-dev/vitest efba8cbfe94b1402a7ccab8a73994cb389cffa4d
fetch_at "$study/changesets" https://github.com/changesets/changesets 9a035ec36045aeb6141dd0bbac9ab9e3c69ac0bc
```

Copy `vitest` and `changesets` to `vitest-nested` and `changesets-nested`, and add `{ "analysis": { "nestedFolders": ["packages/vitest/src/node"] } }` or `{ "analysis": { "nestedFolders": ["packages/cli/src/commands"] } }` as `archmind.config.json` in the copies. Then, from the implementation checkout:

```bash
for repo in archmind vitest vitest-nested changesets changesets-nested; do
  pnpm archmind analyze "$study/$repo" --out "$study/snapshots/$repo.json"
  pnpm archmind check "$study/$repo" --snapshot "$study/snapshots/$repo.json" --format summary
done
```

`check` exits `1` for Vitest and for `changesets-nested` because of cycle errors; that is expected. The summary lists the findings that decide the exit code, and each `*.json.evaluation.json` holds all findings with evidence.

The tables come from the snapshots' stored metrics. This script prints the sweep (`fanOut` above a maximum, every depth and leaf only) for a snapshot:

```js
import { readFileSync } from "node:fs";

const snapshot = JSON.parse(readFileSync(process.argv[2]));
const parents = new Set(snapshot.components.map((component) => component.parentId));
for (const max of [5, 8, 10, 12, 15]) {
  const flagged = snapshot.components.filter((component) => component.metrics.fanOut > max);
  const leaves = flagged.filter((component) => !parents.has(component.id));
  console.log(max, `${flagged.length} / ${leaves.length}`);
}
```

To trace a coupling finding, project the dependencies with the `source` role to the component's depth: map each endpoint to its nearest ancestor at or above that depth, and list the distinct targets. Each dependency's `evidenceImportIds` point at `fileImports`, which have the file, line and specifier. To test for nested duplicates, compare a flagged parent's targets with a flagged descendant's targets mapped to the parent's depth. To trace a cycle, read the finding's `evidence`, and check the `cycles` of kind `file` in the snapshot for a file-level cycle among the members' files. To find the coverage gaps, match each `WORKSPACE_ENTRY_UNMAPPED` diagnostic's `filePath` to a file, and keep the ones whose file has the `source` role.

Results were produced from one run of each command; the evaluations are deterministic for the same snapshot, rules and engine version.
