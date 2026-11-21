# M2 Code Review

Review of the Milestone 2 (Local architecture explorer) implementation against [BACKLOG.md](../BACKLOG.md) (M2.1 to M2.7), [ADR-0001](../adr/ADR-0001-modular-monolith-monorepo.md), [ADR-0003](../adr/ADR-0003-zod-for-contracts-and-validation.md) and the [M2.7 hierarchy validation report](../development/m2-hierarchy-validation.md).

- **Date:** 2026-11-20
- **Method:** static read of the explorer API ([apps/api](../../apps/api/src)), the web explorer ([apps/web](../../apps/web/src)), the explorer contracts and the domain hierarchy projection, plus a review of the M2.7 report. No code was run for this review and nothing was reproduced.
- **Baseline:** `pnpm lint`, `pnpm typecheck` and `pnpm test` passed when M2.7 was completed. The items below were not covered at the time of review.
- **Status tags** used on each item:
  - **Read only:** based on reading the code, not reproduced. Confirm by reproducing before changing behaviour.
  - **Report:** a gap in the M2.7 report, confirmed by re-reading it.

## Summary

The M2 design is sound.

- **Snapshot reader.** [file-snapshot-reader.ts](../../apps/api/src/modules/architecture-model/file-snapshot-reader.ts) opens files with `O_NOFOLLOW` and checks type and size on the open handle. It re-checks the file fingerprint after reading, then validates schema, invariants and content hash before serving a snapshot.
- **Request handling.** Snapshot IDs map to files only through the directory listing. Cursors are bound to their query scope. The loopback host guard and the allowlisted web proxy are tight, and the CORS rule has a test.
- **Projection.** Hidden endpoints use their nearest visible ancestor, and the web client validates responses with the shared contracts.

The gaps are in behaviour that appears only with real-sized inputs: more than four snapshots, repositories with 100 or more components, and long expand lists. Two of them are small bugs (E1, E2). The rest need investigation or design (E3 to E5), and one corrects the M2.7 report (E6).

## Action items

Priority legend:

- **P1:** fix before starting M3. None were found.
- **P2:** fix during M3. These cause visible defects or leave an M2.7 conclusion unsupported.
- **P3:** hardening. Schedule opportunistically.

### P2: Fix during M3

#### E1. Stop the snapshot list from re-parsing every snapshot

- **Status:** Fixed. The API regression test reproduced the extra reads and verifies that a refresh re-reads only changed files without evicting an active graph.
- **Problem:** `ExplorerService.list` in [explorer.service.ts](../../apps/api/src/modules/architecture-model/explorer.service.ts) calls `reader.load` for every snapshot on the page to build its list item. The cache in `FileSnapshotReader` holds only `CACHE_ENTRIES = 4` entries. With five or more snapshots, each list request, including every **Refresh snapshots** click, evicts entries and re-reads, parses and hashes files. The M2.7 run had six snapshots, one of them 5.4 MB.
- **Actions:**
  - [x] Cache a small list summary per file, keyed by the existing file fingerprint, without loading full snapshots into the projector cache.
  - [x] Keep invalid results (reason only) cached by fingerprint too, so a broken file isn't re-read on every list.
  - [x] Add an API test with five or more snapshot files that lists twice and asserts each unchanged file is read once.
- **Acceptance:** Listing N snapshots twice reads each unchanged file at most once, for N greater than the cache size. Changing a file still refreshes its list item.

#### E2. Keep the selected snapshot when refreshing the list

- **Status:** Fixed. Playwright covers preserving a selection on a later page and falling back when it disappears.
- **Problem:** `loadList()` without a cursor in [explorer.tsx](../../apps/web/src/features/explorer/explorer.tsx) always selects the first ready snapshot. Clicking **Refresh snapshots** while viewing another snapshot switches the view and discards expanded components, filters and search.
- **Actions:**
  - [x] Keep `selectedId` when the refreshed list still contains it. Fall back to the first ready snapshot only when it is gone.
  - [x] Add a Playwright test that checks selection, expansion, search and filters after **Refresh snapshots**.
- **Acceptance:** Refresh doesn't change the selection or graph state unless the selected snapshot disappeared.

#### E3. Review graph layout readability on real repositories

- **Status:** Fixed. The screenshots confirmed the problem, and the explorer now uses a layered layout up to 500 internal edges. See the [layout decision](../development/explorer-performance.md#layout-decision).
- **Problem:** [layout.ts](../../apps/web/src/features/explorer/layout.ts) uses the ELK `box` algorithm and never passes edges to ELK. Nodes are packed by size and dependencies are drawn as straight lines across the canvas. At 101 components (Vitest) or 37 (Changesets) this may produce long crossing edges and make direction hard to read. The 300-component benchmark measured speed only.
- **Actions:**
  - [x] Capture screenshots of the default and expanded views of Vitest and Changesets (the M2.7 revisions) with default filters. Record them under [docs/development](../development).
  - [x] Decide from the screenshots whether to keep `box`. If not, evaluate a layered ELK layout that receives the dependency edges, and re-run the [explorer benchmark](../development/explorer-performance.md) against the 2 s and 500 ms budgets.
  - [x] If the layout changes, check that nested expanded components still render inside their parent.
- **Acceptance:** A recorded decision with screenshots. Any layout change stays within the benchmark budgets.

#### E4. Qualify duplicate component names in graph and evidence labels

- **Status:** Fixed. Repeated names are qualified with their path in graph node titles and buttons, edge labels, component list buttons, the detail panel and file graph, and evidence buttons. Playwright covers a fixture with two `pre` components. Original finding: search results and the list showed the path, but graph edge labels in [edges.ts](../../apps/web/src/features/explorer/edges.ts) use only names (`${names.get(source)} depends on ${names.get(target)}`). Evidence buttons read like "View evidence: version to apply-release-plan". M2.7 found duplicates: Changesets has two `pre` components (`packages/pre`, `packages/cli/src/commands/pre`), and Vitest has four `node` components.
- **Problem:** Two components with the same name can't be told apart from graph labels or evidence buttons, for screen reader users in particular.
- **Actions:**
  - [x] Detect duplicate names among visible components and append the full path to node titles, edge `ariaLabel` and evidence button names. The full path was chosen over a shortest distinguishing segment, so a label never changes meaning when siblings are expanded.
  - [x] Add a Playwright test on a fixture with two same-named components that checks the accessible names differ.
- **Acceptance:** No two visible nodes, edges or evidence buttons share an accessible name.
- **Related:** Supersedes the "duplicate component labels" follow-up in [BACKLOG.md](../BACKLOG.md#follow-ups-from-real-repository-validation).

#### E5. Complete the M2.7 evidence

- **Status:** Fixed. The [report](../development/m2-hierarchy-validation.md) traces both edge-count changes with concrete edges, labels what remains observed, records the diagnostic breakdown, and covers further overrides. Original finding: the report stated edge counts but didn't explain them, and its scope was narrow.
- **Problem:**
  - Only one package per repository was tuned. Vitest's `test/**` and `examples/**` and Changesets' `docs` were not.
  - The stored dependency counts changed (Vitest 295 to 262, Changesets 108 to 173) but no specific edges were traced. The report's explanation (ownership changes split or merge aggregate edges) is inferred.
  - The browser check read only the first page of diagnostics (Vitest has 611).
- **Actions:**
  - [x] Diff the default and tuned dependency sets for each repository. List a few concrete examples that were split or merged, and update the report's wording.
  - [x] Try one more override per repository where the default looks unhelpful (for example Changesets `docs`, Vitest `test/e2e`), or record why none is needed. Neither needs one: `docs` is already small, and `test/e2e` is test-only, which the explorer now hides. `nestedFolders` was tried on both packages instead.
  - [x] Note in the report that diagnostics were sampled from the first page only. The overview now also lists totals by code across all pages.
- **Acceptance:** Every number in the report either has a traced example or is labelled as inferred or observed.

### P3: Hardening

#### E6. Bound the `expand` query parameter

- **Status:** Fixed. `projectionQuerySchema.expand` accepts at most 128 values (`MAX_PROJECTION_EXPANSIONS`). Larger lists within the HTTP request-size budget return `400 INVALID_REQUEST` with "At most 128 expand values are allowed." The explorer shows an "Expansion limit reached" alert asking users to collapse components before expanding more. Original finding: component IDs are 68 characters (`cmp:` plus 64 hex), so each `expand` value adds about 76 characters to the URL. Node's default header limit is 16 KB, which is roughly 215 expansions.
- **Problem:** [explorer-schema.ts](../../packages/contracts/src/explorer-schema.ts) had no cap on `expand`. A large expansion set could fail with a generic header or proxy error instead of a validation message.
- **Actions:**
  - [x] Reproduce with expanded IDs through the web proxy and the API directly. The API test and a Playwright test through the proxy send 129 values and check the `400` response.
  - [x] Add a documented maximum to `projectionQuerySchema.expand`. The UI shows a clear message when the limit is reached. An expand-all path was not added.
  - [x] Add a contract test for the limit.
- **Acceptance:** An oversized expand list returns a `400` with a clear message from the schema, not a transport error.

## Backlog changes

Apply these to the follow-ups under M2.7 in [BACKLOG.md](../BACKLOG.md):

- Keep the three existing items on sibling components, fixture noise and missing-edge explanations.
- Replace the duplicate-labels item with E4.
- Add E1 to E3, E5 and E6 as items. E1 and E2 are small bug fixes. The rest need investigation first.
