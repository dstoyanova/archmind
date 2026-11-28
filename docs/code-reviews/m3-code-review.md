# M3 Code Review

Review of the Milestone 3 (Local governance) implementation, M3.1 to M3.5, against [BACKLOG.md](../BACKLOG.md), [ADR-0006](../adr/ADR-0006-governance-rules-and-evaluations.md) and §4.9 and §4.11 of the [MVP plan](../plans/mvp-implementation-plan.md). M3.6 (calibration on real repositories) is not implemented and is out of scope.

- **Date:** 2026-11-26
- **Method:** static read of the rule and evaluation contracts ([contracts](../../packages/contracts/src)), the [governance engine](../../packages/governance-engine/src), `compareEvaluations` in [domain](../../packages/domain/src/compare-evaluations.ts), the [check command](../../apps/cli/src/check.ts), the [governance API module](../../apps/api/src/modules/governance) and the [findings UI](../../apps/web/src/features/explorer), followed by a verification pass. The pass ran the CLI against a throwaway repository in `/tmp` and against ArchMind itself. Nothing was changed in the repository.
- **Baseline (at review time):** `pnpm lint`, `pnpm typecheck` and `pnpm test` pass. Turborepo replayed all three from its cache, so no source had changed since the last full run. Playwright was not run. `archmind check` on ArchMind's own snapshot reports 0 findings and exits 0.
- **Status tags** used on each item:
  - **Verified:** reproduced by running the code. The observed result is quoted.
  - **Read only:** based on reading the code, not reproduced. Confirm by reproducing before changing behaviour.

## Summary

The M3 foundation is sound.

- **Engine.** [evaluate.ts](../../packages/governance-engine/src/evaluate.ts) uses the shared projector and cycle logic, sorts all output, and records a diagnostic for a selector that matches nothing. A broken rule never produces a silent pass in the CLI.
- **Hashes and contracts.** `rulesHash` is separate from the snapshot hashes, and the rules schema reports the rule `id` and field.
- **API.** Evaluations are linked to snapshots by `contentHash`, opened with `O_NOFOLLOW`, size-limited, cached by fingerprint and addressed by opaque IDs. Invalid files are reported with a reason.
- **ArchMind's own rules.** The package-boundary rules use `!(…)` globs, so new packages are covered automatically.

The gaps are in how findings behave over time and in what users can see. Most only appear when a baseline is used on real code, which is what M3.6 and M4 will do.

- **The default `no-cycles` rule produces false "new" and "resolved" findings (G1, verified).** Adding one import inside an existing cycle changes its fingerprint, so `--new-only` fails CI on a cycle that was already in the baseline.
- **The explorer hides rule diagnostics (G2).** A typo in a selector is an exit-2 error in the CLI, but it shows as a clean evaluation in the UI.
- **Comparisons ignore engine and default-rule changes (G3).** The API also rejects evaluations from any other engine version, while the CLI accepts them as baselines.
- **A failing `archmind check` does not say what failed (G4, verified).**
- **Node built-ins cannot be restricted (G5, verified).**

The remaining items are performance and validation gaps in the evaluation reader and the findings UI (G6 to G10).

## Action items

Priority legend:

- **P1:** fix before M3.6. These change what the calibration measures or make baseline gating unreliable.
- **P2:** fix during M3.6 or M4. These cause visible defects or leave an acceptance criterion (AC) only partly met.
- **P3:** hardening. Schedule opportunistically.

### P1: Fix before M3.6

#### G1. Keep cycle fingerprints stable when the cycle gains an internal edge

- **Status:** Fixed. A cycle's fingerprint is now the rule ID and its sorted member keys. The dedupe key for a cycle at several depths is its member set, and endpoints are no longer tracked. ADR-0006 amendment and plan §4.9 updated, engine version `0.2.0`. Engine tests cover an added edge (same fingerprint) and a new member (new fingerprint). Original status: verified. In a three-component cycle `a → b → c → a`, the baseline had `archmind/no-cycles`, a `layers` finding and a `forbidden-dependency` finding. Adding the import `b → a` and running `check --baseline base.evaluation.json --new-only` printed `baseline: 1 new, 2 existing, 1 resolved` and exited `1`. The cycle was still there, and the other two findings were correctly `existing`.
- **Problem:** `addFinding` in [evaluate.ts](../../packages/governance-engine/src/evaluate.ts) hashes the cycle's member keys **and** its internal endpoints (`cycle.endpoints`). Any new component-level edge inside an existing strongly connected component (SCC), or any edge that disappears, changes the fingerprint.
  - An existing cycle is reported as both resolved and new.
  - With `--new-only`, a team that has baselined its legacy cycles fails CI as soon as someone touches one.
  - The "resolved" count is also wrong, which feeds the health summary and the UI.
  - The test "keeps fingerprints stable across unrelated edits" in [evaluate.test.ts](../../packages/governance-engine/src/evaluate.test.ts) does not cover edits inside the SCC.
- **Actions:**
  - [x] Decide what identifies a cycle. The simplest option is the sorted member keys alone, without endpoints. A cycle that gains or loses a member is then a different finding, which is defensible. A cycle that only gains an edge is the same finding.
  - [x] Update ADR-0006 and §4.9, which say fingerprints include "dependency endpoints".
  - [x] Check that two SCCs at different depths with the same member keys cannot collide.
  - [x] Add an engine test that adds an edge inside an SCC and asserts an equal fingerprint, plus a test for member growth.
- **Acceptance:** Adding or removing an edge between existing members of a cycle leaves its fingerprint unchanged. `--new-only` does not fail on it.

#### G2. Show rule diagnostics in the explorer

- **Status:** Fixed. The findings panel fetches the evaluation detail and lists rule diagnostics above the findings. Playwright covers an evaluation with a `SELECTOR_NO_MATCH` diagnostic. Original status: read only. `EvaluationDetail` in [governance-schema.ts](../../packages/contracts/src/governance-schema.ts) carries `diagnostics`, and `GET /evaluations/:id` returns them. A search of `apps/web/src` finds no code that fetches that endpoint. `fetchEvaluations`, `fetchFindings`, `fetchFinding` and `fetchHealth` are the only governance calls, and the health view model has no rule diagnostics.
- **Problem:** The design rule is that a selector that matches nothing "is never a silent pass" (ADR-0006, M3.2). The CLI keeps this by exiting `2`. The explorer does not.
  - A rule with a misspelt selector, or an ambiguous layer (`AMBIGUOUS_LAYER`), is not evaluated.
  - In the explorer it looks like an evaluation with no findings for that rule.
  - The "Evaluation health" section shows analysis coverage but not rule coverage.
- **Actions:**
  - [x] Fetch the evaluation detail when an evaluation is selected and list its rule diagnostics (rule ID, field, message) above the findings, using an `Alert` as for evaluation issues.
  - [x] Add the diagnostic count to the health view model, or show it from the detail response.
  - [x] Add a Playwright case using a fixture evaluation with a `SELECTOR_NO_MATCH` diagnostic.
- **Acceptance:** An evaluation with rule diagnostics shows them in the explorer without opening the JSON.

#### G3. Make engine and default-rule changes visible in comparisons, and align the CLI and API on versions

- **Status:** Fixed. `compareEvaluations` flags `engineChanged`, carried through the API, CLI summary and UI. The API now reads evaluations of any engine version whose schema is supported (the `unsupported-engine` rejection is gone, and `apps/api` no longer depends on `governance-engine` at runtime). The CLI and the API agree. Tests cover the domain flag, the CLI summary and an older-engine baseline in the API. Original status: read only. The strict version check is intended: [governance.test.ts](../../apps/api/tests/governance.test.ts) asserts `unsupported-engine.evaluation.json` is invalid. The consequences are not covered.
- **Problem:** Two related issues that M3.6 will trigger, because ADR-0006 requires a `governanceEngineVersion` bump when built-in rules change and M3.6 is to calibrate the default threshold.
  - **Comparison.** `compareEvaluations` only flags `rulesChanged` and `hierarchyChanged`. `rulesHash` excludes built-in definitions and the engine version by design. A change to the default `max: 10`, or to cycle semantics, therefore produces new and resolved findings with both flags `false`. Users cannot tell churn from a code change.
  - **Version handling.** [file-evaluation-reader.ts](../../apps/api/src/modules/governance/file-evaluation-reader.ts) accepts only an exact `GOVERNANCE_ENGINE_VERSION`. After one bump, every stored evaluation and every baseline becomes `422 INVALID_EVALUATION` in the explorer. The CLI's `readBaseline` in [check.ts](../../apps/cli/src/check.ts) validates only the schema, so the same file works as a CLI baseline.
- **Actions:**
  - [x] Add `engineChanged` (differing `governanceEngineVersion`) to `compareEvaluations`, the findings and health responses, the CLI summary and the UI, next to the existing flags.
  - [x] Decide the API policy. Either accept older engine versions as read-only (the schema is versioned separately) and flag them, or keep rejecting them and say in the CLI docs that a baseline from an older engine cannot be browsed. Whichever is chosen, make the CLI and API agree.
  - [x] Add a test for the chosen behaviour.
- **Acceptance:** A comparison across engine versions says so. A baseline accepted by the CLI is not unreadable in the explorer without an explanation.

### P2: Fix during M3.6 or M4

#### G4. Say what failed in `archmind check` output

- **Status:** Fixed. The summary lists up to 20 deciding findings, each with rule, message and first import location, and the default format prints one stderr line when the exit code is `1`. CLI tests cover both. Original status: verified. In a repository with three findings, `archmind check .` exited `1` and printed nothing. With `--format summary`, the output was only counts: `findings: 3 error(s), 0 warning(s)`, `archmind/no-cycles: 1`, `layers: 1`, `overlap: 1`.
- **Problem:** The CI step added in M3.3 runs `check --format summary`. When it fails, the log shows how many findings there are but not which components or imports caused them. The reader has to download the evaluation JSON. The M3.3 AC ("`--format summary` prints findings by severity and rule") is met literally.
- **Actions:**
  - [x] In the summary, print the findings that decide the exit code (new ones with `--new-only`): rule ID, message and the first evidence location. Cap the list (for example 20) and print the remainder as a count.
  - [x] Print one line to stderr in the default format when the exit code is `1`, for example `3 findings at or above "error". Use --format summary to list them.`
  - [x] Add a CLI test on the output.
- **Acceptance:** A failing CI log names at least the first violations without opening artifacts.

#### G5. Allow `restricted-package` to cover Node built-ins, or document the limit

- **Status:** Fixed. Built-ins are in scope: `restricted-package` accepts `node:<module>` names, matches the module and its subpaths with or without the prefix, and a bare built-in name is a `BUILT_IN_MODULE_NAME` rule diagnostic. Contract and engine tests cover both. Original status: verified. `"packages": ["node:fs"]` fails validation with `Rule "nofs2", packages.0: Expected an exact package name.` A rule with `"packages": ["fs"]` is accepted. An import of `fs` and one of `node:fs` are both stored as `node-built-in` with no `externalPackage`, and the rule produced no finding.
- **Problem:** `restricted-package` only sees `resolution: "external-package"`. The rule type documented for "external packages that only listed components may import" therefore cannot express a common boundary, such as "the domain package uses no `node:*`". The `fs` case is accepted and then silently never matches, which is the silent pass the design tries to avoid.
- **Actions:**
  - [x] Decide whether built-ins are in scope. If yes, accept `node:`-prefixed names in `packageName` and match `node-built-in` imports by specifier.
  - [x] If no, reject built-in names in the schema with a clear message, and state the limit in ADR-0006.
  - [x] Add a test either way.
- **Acceptance:** A rule that names a built-in either works or is rejected at validation.

#### G6. Stop the evaluation reader from re-parsing files on every list

- **Status:** Fixed. `FileEvaluationReader.summarize` caches a per-file summary (or the invalid reason) by file fingerprint, and the list uses it. A new reader test lists 11 files twice and asserts no second read. Original status: read only.
- **Problem:** `GovernanceService.list` in [governance.service.ts](../../apps/api/src/modules/governance/governance.service.ts) calls `evaluations.load` for every `*.evaluation.json` in the directory, on every request, only to read `contentHash`. `FileEvaluationReader` keeps `CACHE_ENTRIES = 8` full parsed documents with LRU eviction. A directory with nine or more evaluations makes every list request read, parse and validate every file again, because a sequential scan always evicts the entry it needs next. This is the problem M2 E1 fixed for snapshots. Each evaluation can be up to 16 MiB. The cache test covers one file only.
- **Actions:**
  - [x] Cache a small per-file summary (identity, metadata, or the invalid reason) by file fingerprint, as the snapshot reader does, and keep the document cache for detail, findings and health.
  - [x] Add an API test with at least nine evaluation files that lists twice and asserts each unchanged file is read once.
- **Acceptance:** Listing N evaluations twice reads each unchanged file at most once, for N greater than the cache size.

#### G7. Validate an evaluation against its snapshot

- **Status:** Fixed. When an evaluation is listed or loaded, `findIntegrityIssue` checks the analysis config hash, finding components and evidence files against its snapshot, once per file revision and snapshot content. Mismatches are reported as invalid with a reason. API tests cover an unknown component and an unknown file. Original status: read only.
- **Problem:** The M3.4 AC says evaluation files are "validated on load like snapshots". A snapshot is checked for schema, invariants and content hash. An evaluation is checked for schema, version and unique fingerprints, and linked to a snapshot by `contentHash` only. It is never checked that its findings refer to the snapshot.
  - Component IDs in `subject`, and evidence file paths, are not compared with the snapshot.
  - Fingerprints are not recomputed, and the document has no integrity hash.
  - A stale or edited file with the right `contentHash` loads normally. `health` then silently drops unknown components from `topComponents`, and the UI fails only later, at "The finding subject is not available in this snapshot."
- **Actions:**
  - [x] When the API links an evaluation to a snapshot (it already loads the snapshot for `health`), check that subject component IDs exist and evidence files are in the snapshot. Report a mismatch as an invalid evaluation with a reason.
  - [x] Add a test with an evaluation that matches the hash but names an unknown component.
- **Acceptance:** An evaluation that cannot be rendered against its snapshot is reported as invalid when listed or loaded.

#### G8. Guard the baseline choice

- **Status:** Fixed. Choosers show finding count, short rules hash and engine version. The baseline can come from this snapshot (the default) or another one. `unrelatedBaseline` is computed from evaluations alone (CLI, API and UI), because local snapshots have no repository identity. `createdAt` is not shown, because an evaluation records its snapshot's creation time. Original status: read only.
- **Problem:** Any evaluation can be a baseline. Neither the CLI nor the API checks that it describes the same project, and the UI offers only file names.
  - A baseline from another repository gives "all new, all resolved" with no hint, and `--new-only` then fails on everything.
  - The evaluation choosers in [findings-panel.tsx](../../apps/web/src/features/explorer/findings-panel.tsx) show only `label`. Two evaluations of one snapshot under different rules look the same.
  - Choosing a baseline takes two steps: first a baseline snapshot, then its evaluation.
- **Actions:**
  - [x] Show `createdAt`, `rulesHash` (short) and the finding count next to each evaluation.
  - [x] Add a comparison warning when head and baseline share no component keys or findings. Local snapshots have no repository identity, so this is the cheap signal.
  - [x] Offer evaluations of the current snapshot as baselines without choosing a baseline snapshot first.
- **Acceptance:** A comparison against an unrelated evaluation is flagged, and users can tell evaluations apart in the chooser.

#### G9. Make graph highlights follow the list filters, and measure them at scale

- **Status:** Fixed. A `highlights` endpoint (with the list filters, capped at 10,000 and with the total) replaces the page loop. Badges follow the filters, exclude resolved findings and are coloured by highest severity. The full hierarchy fetch uses `includeDependencies=false`. The benchmark now has 3,299 findings (first render 444 ms, expand 398 ms, collapse 399 ms). Original status: read only. The benchmark in [explorer-performance.md](../development/explorer-performance.md) uses 299 findings.
- **Problem:** In `FindingsPanel`, the highlight effect loads every page of the selected evaluation's findings, with no baseline and none of the list filters, and passes them to the graph.
  - Badge counts therefore ignore the severity, rule and status filters. Filtering to "error" or "new" leaves the badges unchanged, and resolved findings are never highlighted.
  - Every page request repeats the evaluation lookup, snapshot index and baseline comparison in `GovernanceService.findings`, so cost grows with pages times findings. The default `archmind/high-coupling` rule can report many components on a large repository.
  - Badges are always red, even for warnings.
  - The full hierarchy fetch (`fetchFullGraph`, `depth=MAX_SAFE_INTEGER`) returns edges and evidence IDs that the highlight does not need.
- **Actions:**
  - [x] Decide whether badges follow the filters. Following them is the simpler mental model. If so, pass the filtered set, or a per-component count endpoint, to the graph.
  - [x] Replace the page loop with one lightweight request (component ID and severity per finding), or cap it with a notice.
  - [x] Extend the performance benchmark to a few thousand findings and record the result.
  - [x] Colour the badge by the highest severity.
- **Acceptance:** Badges match what the list shows. Selecting an evaluation with thousands of findings stays within the M2 budgets.

#### G10. Make "Show on graph" point at the offending dependency

- **Status:** Fixed. The reported dependency, or a cycle's internal dependencies, is drawn with a `finding-edge` class and an accessible label, and a jump keeps the current expansion only when it fits within 128. Playwright covers the edge. The over-the-limit fallback has no automated test, because it needs more than 128 nested components. Original status: read only. `planFindingJump` in [explorer.tsx](../../apps/web/src/features/explorer/explorer.tsx) expands the ancestors of every subject and sets `focus` to `subjects[0]`.
- **Problem:** For a `dependency` or `external-package` finding the graph focuses the source component only. The offending edge is not highlighted, so the user has to find it among the visible edges.
  - Ancestors are added to `expanded` and never removed. After a few jumps on a deep repository the set reaches `MAX_PROJECTION_EXPANSIONS` (128), and the next jump fails with "Collapse some graph components before jumping to this finding."
- **Actions:**
  - [x] Highlight the edge (and for cycles the member components) for the selected finding, using the existing edge styling for cycles.
  - [x] Start a jump from the minimal expansion for the finding, or drop expansions that the finding does not need.
  - [x] Add a Playwright case for a dependency finding that checks the edge.
- **Acceptance:** Jumping to a dependency finding shows which edge violates the rule, and repeated jumps do not hit the expansion limit.

### P3: Hardening

#### G11. Bound cycle messages and review default-rule volume

- **Status:** Fixed. Messages name at most five members, and the default coupling rule reports leaf components only after the M3.6 calibration (4 of 13 findings were nested duplicates). Original status: read only.
- **Problem:**
  - A cycle finding's message lists every member path (`Dependency cycle involving a; b; c; …`). For a large SCC, the message in the findings list and in the evaluation JSON can be several kilobytes. The `componentIds` array is unbounded, too.
  - `archmind/high-coupling` uses selector `.`, which matches every component at every depth. A parent and its children can all report the same coupling, and a package's `fanOut` is also counted in each ancestor.
- **Actions:**
  - [x] Truncate the member list in the message (for example the first 5, plus "and N more"). Keep the full list in `subject`.
  - [x] Look at the duplicate threshold findings when calibrating in M3.6, and consider restricting the default to one depth or to leaf components. Done in M3.6: the default is now leaf components only. See [ADR-0006](../adr/ADR-0006-governance-rules-and-evaluations.md#2026-11-28) and the [validation report](../development/m3-default-rules-validation.md).
- **Acceptance:** Message length is bounded. M3.6 records how many default findings are nested duplicates: 4 of 13 across five hierarchies.

## Acceptance criteria versus evidence

The table shows the state at review time. The related items above are fixed since.

| AC | Status | Related items |
| --- | --- | --- |
| M3.1: rules validated with zod, errors name the rule `id` and field; root rejects unknown keys; `analyze` ignores invalid `rules`; `rulesHash` is independent of the snapshot hashes | **Met.** Covered by [rules-schema.test.ts](../../packages/contracts/src/rules-schema.test.ts) and [analyze.test.ts](../../apps/cli/src/analyze.test.ts). A rule with a built-in name is accepted by the schema but never matches | G5 |
| M3.2: fingerprints "stay stable across unrelated edits" | **Partly met.** Stable for unrelated files. Not stable when a cycle gains an internal edge (verified) | G1 |
| M3.2: a selector that matches nothing produces a diagnostic, "no silent pass" | **Met** in the engine and the CLI (exit `2`). Not visible in the explorer | G2 |
| M3.2: `compareEvaluations` flags `rulesChanged` and `hierarchyChanged` | **Met.** Engine version and default-rule changes are not flagged | G3 |
| M3.3: `--format summary` prints findings by severity and rule, comparison and coverage | **Met literally.** Counts only, no finding details (verified) | G4 |
| M3.3: exit codes `0`, `1` and `2` are documented | **Met.** Rule diagnostics share code `2` with tool errors, and the doc says so | |
| M3.3: ArchMind declares package-boundary rules and CI passes | **Met.** `archmind check` on ArchMind gives 0 findings, exit `0` (ran) | |
| M3.4: evaluation files validated on load "like snapshots"; fingerprint caching | **Partly met.** Schema, version, size and `O_NOFOLLOW` are checked. Nothing is checked against the snapshot. The cache holds 8 documents, so the list scan thrashes above that | G6, G7 |
| M3.4: health summary has coverage, counts and top components | **Met** | |
| M3.5: highlights on the nearest visible ancestor, with a count | **Met.** The counts ignore the list filters and baseline | G9 |
| M3.5: jump expands to the subject and applies the rule's role and type-only scope | **Met** for components. The offending edge is not highlighted | G10 |
| M3.5: highlighting stays within the M2 budgets | **Met at 299 findings only** | G9 |
| M3.5: findings list is keyboard-navigable | **Met.** Each finding is a button, so it is reachable by Tab, and the Playwright case uses the keyboard | |

## Suggested order of work

1. **Finding identity and comparison:** G1, then G3. M3.6's calibration and any baseline use depend on both.
2. **Visibility of broken rules:** G2, G5.
3. **CLI usability:** G4.
4. **Reader and validation:** G6, G7.
5. **Explorer behaviour and scale:** G8 to G10, with the extended benchmark.
6. **Cleanup:** G11 during M3.6.

## Backlog changes

Applied to the M3 section of [BACKLOG.md](../BACKLOG.md):

- Add G1 to G3 before M3.6 and list them as dependencies of it.
- Add G4 to G10 as M3 follow-ups, and note which acceptance criteria they leave only partly met (see the table above).
- Fold G11 into M3.6, which already covers default calibration.
