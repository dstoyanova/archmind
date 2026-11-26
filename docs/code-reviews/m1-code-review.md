# M1 Code Review

Review of the Milestone 1 (Local analysis CLI) implementation against [BACKLOG.md](../BACKLOG.md), the [MVP implementation plan](../plans/mvp-implementation-plan.md) and ADR-0001 to ADR-0005.

- **Date:** 2026-11-16
- **Method:** static read of the code, ADRs, CI and docs, followed by a verification pass that ran the tooling and reproduced the findings with throwaway tests against the real `analyzeRepository` (removed afterwards, nothing committed).
- **Baseline:** `pnpm lint`, `pnpm typecheck` and `pnpm test` all pass (12 test files, 34 tests). The problems below are not caught by the current suite.
- **Status tags** used on each item:
  - **Verified:** reproduced by running the code. The observed result is quoted.
  - **Read only:** based on reading the code, not reproduced.

## Summary

The structure is sound. Package boundaries are respected, the pipeline is cleanly staged, and the invariants, schema, projection and tests are in place.

The verification pass confirmed the main concerns. The most serious ones, all reproduced:

- **Reproducibility is broken in two ways (R1, R2, R3).**
  - The same repo analysed in two directories gives a different `contentHash` when a diagnostic embeds an absolute path.
  - The same repo under `LANG=en_US` and `LANG=sv_SE` also gives a different `contentHash`.
- **The built CLI cannot start (R5).**
- **Depth-level cycles and metrics miss edges from a package's own files (R4).**
- **Tarjan crashes with a stack overflow on a 12,000-file dependency chain (R12).**

Other gaps are in module resolution and discovery, and some M1 acceptance criteria (AC) are ticked without evidence.

### Corrections after verification

- R7 (ghost folders) needs specific conditions to occur. It did not reproduce when the root has a `src/` directory.
- R9: `#subpath` imports that map to an in-repo file **do** resolve. The remaining problem is that they are excluded from the unresolved-rate denominator.
- R1: hashing the same fixture from a copied directory works when there are no diagnostics. The failure appears only when a diagnostic embeds an absolute path.

## Action items

Priority legend:

- **P1:** fix before starting M2. These affect correctness or the core reproducibility promise.
- **P2:** fix during or before M2. These cause visible defects in the explorer or fragile behaviour.
- **P3:** cleanup and hardening. Schedule opportunistically.

### P1: Fix before M2

#### R1. Add an end-to-end reproducibility test

- **Status:** Verified. A repo with `"extends": "./missing-base.json"` analysed in two temp directories gave different `contentHash` values. The `single-package` fixture copied to another directory gave equal hashes.
- **Problem:** M1.8 says identical `contentHash` across runs and directories is "covered by tests".
  - The only `contentHash` test is at builder level, in [snapshot-builder.test.ts](../../packages/architecture-engine/src/snapshot-builder.test.ts). It checks only that metadata changes don't alter the hash.
  - [analyze.test.ts](../../apps/cli/src/analyze.test.ts) never analyses the same fixture twice or in two directories.
- **Actions:**
  - [x] Add a test that analyses one fixture in two temp directories and asserts equal `contentHash`.
  - [x] Add a test that runs the same directory twice.
  - [x] Include a fixture with a diagnostic (for example a missing relative `extends`) so R3 is exercised.

#### R2. Replace `localeCompare` ordering with a codepoint comparator

- **Status:** Verified. A repo with files `B.ts`, `a.ts`, `ä.ts`, `z.ts` produced a different `contentHash` under `LC_ALL=en_US.UTF-8` (order `a, ä, B, z`) than under `LC_ALL=sv_SE.UTF-8` (order `a, B, z, ä`). Codepoint order would be `B, a, z, ä`.
- **Problem:** `localeCompare` is used in about 70 places: the provider, extractor, resolver, mapper, graph code, snapshot builder, the CLI, and the hash key normalisation (`normalizeForHash`).
  - Results depend on the process locale and ICU build, so the same input can hash differently across machines or environments.
  - This breaks NFR-1, notably for CLI versus GitHub worker snapshots from M4 on.
- **Actions:**
  - [x] Introduce one shared codepoint comparator, for example `a < b ? -1 : a > b ? 1 : 0`, and use it for every sort that feeds output or the hash.
  - [x] Replace the three copies of `normalizeForHash` with one canonical-JSON helper.
  - [x] Specify canonical JSON, key ordering and collection ordering in [ADR-0004](../adr/ADR-0004-immutable-versioned-snapshot-and-content-hash.md), which is currently thin on this. Consider a superseding or addendum ADR.

#### R3. Keep diagnostics repo-relative and out of host-specific text

- **Status:** Verified for the absolute path. The snapshot contained `Cannot read file '/var/folders/…/zz-F3jo1n/missing-base.json'.` with code `TSCONFIG_PARSE_ERROR`. The `@` misclassification is read only.
- **Problem:** diagnostics are hashed, but tsconfig diagnostics in [module-resolver.ts](../../packages/code-analysis/src/module-resolver.ts) use `ts.flattenDiagnosticMessageText` verbatim.
  - A missing relative `extends` yields `Cannot read file '/abs/…'`, which differs per checkout and leaks local paths.
  - `isUnresolvedPackageExtendsDiagnostic` matches on `includes("@")`, so any absolute path containing `@` is misclassified.
  - The existing fixture covers only a package-name `extends`, which doesn't expose this.
- **Actions:**
  - [x] Rewrite diagnostic messages to repo-relative paths before they enter the snapshot.
  - [x] Classify unresolved-package `extends` by inspecting the `extends` value (bare specifier), not the message text.
  - [x] Cover with the R1 test.

#### R4. Unify projection with depth-level cycles and metrics

- **Status:** Verified. With `src/index.ts` importing `./feature/a` and `src/feature/a.ts` importing `../index`, only a file-level cycle was reported (no depth-2 cycle). The `feature` folder had `fanIn: 0` and `fanOut: 0`.
- **Problem:** `projectEdgesAtDepth` in [graph-metrics-cycles.ts](../../packages/architecture-engine/src/graph-metrics-cycles.ts) maps endpoints to the ancestor at exactly that depth.
  - Files owned directly by a package (for example `src/index.ts` or a barrel) have no depth-2 ancestor, so their edges are dropped at depth 2.
  - A folder ↔ barrel cycle is found at file level but missed at depth 2. Folder fan-in and fan-out are understated.
  - The plan says projection maps to the **nearest visible ancestor**, and [project-graph.ts](../../packages/domain/src/project-graph.ts) does that. The two implementations disagree.
  - §4.2 of the plan puts projection and cycle detection in `domain` so the explorer, governance and agent share one implementation. M3 needs to recompute cycles under filters (tests, type-only opt-in).
- **Actions:**
  - [x] Use a single projection, either nearest-ancestor mapping or a "parent's own files" pseudo-node, for projection, metrics and cycles.
  - [x] Move Tarjan and projection into `domain`, or record the deviation in an ADR.
  - [x] Add tests for a folder ↔ package-root-file cycle and for fan-in and fan-out with barrel files.

#### R5. Fix how the CLI runs

- **Status:** Verified. After `pnpm --filter @archmind/cli build`, `node apps/cli/dist/src/main.js analyze …` fails with `ERR_MODULE_NOT_FOUND` for `packages/architecture-engine/src/component-hierarchy-mapper.js` (imported from `index.ts`). The documented `pnpm dlx tsx apps/cli/src/main.ts analyze …` works, but it downloads an unpinned `tsx` and `tsx` is not a repo dependency.
- **Problem:** `bin` points to `dist/src/main.js`, but every `@archmind/*` package exports `./src/index.ts` and sources import `./x.js`, so the built output cannot run.
  - The CLI guide (`docs/development/cli-analyze.md`, now merged into the README) worked around this with an unpinned `pnpm dlx tsx`. That downloads and executes an unpinned package on each run, and makes the documented "build" prerequisite pointless.
- **Actions:**
  - [x] Either add a pinned `tsx` devDependency and use it in scripts and docs, or bundle the CLI so `bin` works.
  - [x] Add a CI step that runs `archmind analyze` on a fixture.

#### R6. Consolidate workspace discovery and orchestration

- **Status:** Verified for the CLI behaviour. A `pnpm-workspace.yaml` with an unrelated `onlyBuiltDependencies: - tools/*` list made `tools/t` a package component. A malformed `packages/a/package.json` made `analyzeRepository` throw a raw `SyntaxError`. The resolver-side behaviour is read only.
- **Problem:** workspace discovery exists in [analyze.ts](../../apps/cli/src/analyze.ts) and in `discoverWorkspacePackages` in [module-resolver.ts](../../packages/code-analysis/src/module-resolver.ts), plus extra directory walks for `package.json`. They disagree.
  - The CLI's pnpm YAML parser matches any `- x` line in the file, so `onlyBuiltDependencies:` or catalog lists become workspace globs. The resolver's parser correctly stops at the end of `packages:`.
  - Neither supports `!negation` globs.
  - A malformed `package.json` throws in the CLI but is silently ignored by the resolver.
  - Duplicated logic means a future worker (M4) could produce different results from the CLI.
- **Actions:**
  - [x] Implement workspace discovery once (in `code-analysis`) and use it for both resolution and component mapping.
  - [x] Move the `analyzeRepository` orchestration out of `apps/cli` into a package so the M4 worker reuses it.
  - [x] Support negation globs, and emit a diagnostic for malformed manifests.
  - [x] Add a test with a pnpm workspace file that has extra list sections.

### P2: Fix during or before M2

#### R7. Remove ghost folder components

- **Status:** Verified, with conditions. With a named root `package.json` (workspaces `packages/*`), no root `src/`, and `packages/a/src/x/y.ts`, the snapshot contained an empty `packages` folder component (0 files) and a `<package-root>` package with 0 files. It did **not** reproduce when the root has a `src/` directory.
- **Problem:** `findImmediateFoldersUnderRoot` in [component-hierarchy-mapper.ts](../../packages/architecture-engine/src/component-hierarchy-mapper.ts) builds folder components from all files under a package root without excluding files owned by nested packages.
  - For a named root `package.json`, `package:.` gets empty `apps` and `packages` folder children with `fileCount: 0`.
- **Actions:**
  - [x] Exclude files owned by nested packages when creating folder components.
  - [x] Add a test for a monorepo whose root has a named `package.json`.

#### R8. Don't silently drop imports into excluded files

- **Status:** Verified. With `src/ignored.ts` in `.gitignore`, `import "./ignored.js"` was reported as `internal-file` with no `toFileId`, no diagnostic, and it was not counted as unresolved.
- **Problem:** the resolver's file set doesn't respect `.gitignore` or the generated, oversized and `.d.ts` exclusions that the snapshot file set does.
  - Such an import is labelled `internal-file` with no `toFileId`. It never becomes an edge and isn't counted as unresolved.
- **Actions:**
  - [x] Feed the resolver the discovered file set, or emit a diagnostic or distinct resolution status for imports into excluded files.

#### R9. Make the unresolved rate trustworthy

- **Status:** Verified, with a correction to the original claim.
  - `import "./styles.css"` and `./a.json` are `unresolved` and count toward the rate. A repo with one such import had an unresolved rate of 100%.
  - `#internal` mapped to an in-repo file in package.json `imports` **does** resolve (as `internal-file`). An unresolvable `#nope` is `unresolved` but is excluded from both the numerator and denominator.
  - The benchmark margin (vitest 1.94% against 2%) is from the recorded results and was not re-run.
- **Problem:**
  - `import "./x.css"`, `.json` and `.svg` end up "unresolved" and inflate the rate.
  - Unresolvable `#subpath` imports (the package.json `imports` field) are excluded from the rate, which deflates it.
  - The benchmark result for vitest is 1.94% against a 2% limit, so it is fragile.
- **Actions:**
  - [x] Classify asset imports separately.
  - [x] Include unresolved `#` specifiers in the rate.
  - [x] Re-run the benchmark and update [m1-resolution-benchmark.md](./m1-resolution-benchmark.md).

#### R10. Close extraction gaps

- **Status:** Verified except the private-API item. For a file with `import fs = require("fs")`, `export { type A } from`, `export * from`, `export default function () {}` and `type T = import("./x.js").X`: the `require` import and the `import()` type were not extracted, `export { type A } from` was `re-export` (not `type-only`), and the only symbol from that file was `default`. The `parseDiagnostics` private-property access is read only.
- **Problem:** in [import-symbol-extractor.ts](../../packages/code-analysis/src/import-symbol-extractor.ts):
  - `import x = require("y")` and `import("x")` type nodes are not extracted.
  - `export { type A } from "x"` is not classified `type-only`, although `import { type A }` is.
  - Re-exports, `export default <expr>` and `export { a }` produce no symbols, so barrel files show none.
  - `getParseDiagnostics` reads TypeScript's private `parseDiagnostics`, which is fragile across upgrades.
- **Actions:**
  - [x] Add the missing import forms and the all-specifiers-`type` rule for exports.
  - [x] Extract re-exported and default-exported symbols.
  - [x] Replace the private-API access with a supported approach, or pin and test it explicitly.

#### R11. Close source discovery gaps

- **Status:** Verified except `.git` and the repeated reads.
  - `src/build/real.ts` and `src/out/real2.ts` were silently absent from `files`.
  - A nested `pkg/.gitignore` (`secret.ts`) was ignored: `pkg/secret.ts` was included.
  - Changing the tsconfig `paths` left `source.sourceHash` unchanged.
- **Problem:** in [local-fs-source-provider.ts](../../packages/code-analysis/src/local-fs-source-provider.ts):
  - Only the root `.gitignore` is applied. Nested ones are ignored.
  - `dist`, `build` and `out` are excluded at any depth, so a source folder like `src/build/` disappears silently.
  - `.git` is not excluded from the walk (the resolver does exclude it).
  - `sourceHash` ignores tsconfig, `package.json` and workspace files, which affect resolution. A change to `paths` leaves the local idempotency key unchanged (NFR-4).
  - Each file is read three or four times, so the hash can drift from the parsed content between reads.
- **Actions:**
  - [x] Apply nested `.gitignore` files.
  - [x] Exclude build output only where it is real build output (for example at the package root, or when listed in `.gitignore`).
  - [x] Exclude `.git`.
  - [x] Include resolution-relevant config files in `sourceHash`, and document it in ADR-0004.
  - [x] Read each file once and reuse the bytes for hash, parse and `loc`.

#### R12. Fix performance hot spots

- **Status:** The Tarjan stack overflow is verified: analysing a 12,000-file linear import chain failed after about 2.7 s with `RangeError: Maximum call stack size exceeded`. The quadratic costs are read only and were not measured.
- **Problem:**
  - `directoryExists` and `getDirectories` in the resolver host scan every repo file per call, so cost is roughly files × lookups.
  - `findNearestTsConfig` is linear per import.
  - Tarjan is recursive, so a deep graph risks a stack overflow.
  - `cycleMembers.includes` inside edge filters is O(n²) on large strongly connected components.
- **Actions:**
  - [x] Precompute a directory set and a tsconfig-by-directory index.
  - [x] Make Tarjan iterative.
  - [x] Use `Set` for membership checks.
  - [x] Re-measure NFR-7 and record the result, including engine version and machine.

#### R13. Strengthen snapshot invariants and schema

- **Status:** Read only.
- **Problem:** [invariants.ts](../../packages/domain/src/invariants.ts) checks only file→component, dependency→component and duplicate file paths, which is narrower than the AC. Snapshots will be read from disk in M2 and from the database in M4.
  - Missing checks: duplicate component IDs, `parentId` and `depth` consistency, import `fromFileId`, `toFileId` and `toComponentId`, symbol `fileId`, `evidenceImportIds`, and cycle members.
  - The schema is loose: `parseStatus` should be an enum, `unresolvedRate` should be ≤ 1, `createdAt` should be a datetime.
- **Actions:**
  - [x] Add the missing invariants with tests.
  - [x] Tighten the schema fields.
  - [x] Add `verifyContentHash(snapshot)` so immutability is checkable on read.

#### R14. Harden config validation and ID stability

- **Status:** Verified for the silent typo and the raw `ZodError`: `{"analysis":{"componentRoot":…}}` was accepted silently, and `{"analysis":{"components":"nope"}}` threw a raw `ZodError`. The other points are read only.
- **Problem:**
  - The `analysis` section isn't `.strict()`, so typos like `componentRoot` are silently ignored.
  - `fileRoles.source` is accepted but ignored.
  - `componentRoots` keys aren't normalised (`./apps/api` or a trailing `/` won't match).
  - An unknown or cyclic configured `parent` silently falls back to root with no diagnostic.
  - Duplicate component names collapse in `configuredByName`.
  - Configured component IDs embed the array index, so reordering config renames IDs. That will break baselines in M3.
  - A raw `ZodError` reaches the user.
- **Actions:**
  - [x] Make the `analysis` schema strict, and reject or drop `fileRoles.source`.
  - [x] Normalise `componentRoots` keys.
  - [x] Emit diagnostics for unknown or cyclic parents, and reject duplicate names.
  - [x] Derive configured component IDs from name or path instead of index.
  - [x] Format config errors readably in the CLI.

#### R15. Own versions in the right places and declare dependencies

- **Status:** Read only. `ENGINE_VERSION` is hardcoded in [analyze.ts](../../apps/cli/src/analyze.ts), and [package.json](../../packages/code-analysis/package.json) for `code-analysis` does not list `typescript`.
- **Problem:**
  - `ENGINE_VERSION = "0.1.0"` is hardcoded in the CLI.
  - `code-analysis` imports `typescript` without declaring it in its `package.json`. It works only through root hoisting.
  - Nothing forces a version bump when engine logic changes, so the idempotency key `repo + source + engineVersion` can collide.
- **Actions:**
  - [x] Export `ENGINE_VERSION` from `architecture-engine` and `PARSER_VERSION` from `code-analysis`.
  - [x] Declare `typescript` in `packages/code-analysis`.
  - [x] Add a guard (for example a golden-snapshot test) that fails when output changes without a version bump.

#### R16. Fix git metadata handling and trust

- **Status:** Verified for the subdirectory case: analysing `apps/cli/fixtures/single-package` recorded the outer repository's `commitSha`, `branch` and `workingTreeDirty`. The failed-status and `core.fsmonitor` points are read only.
- **Problem:** in `runGitCommand` and `readGitSourceMetadata` in [analyze.ts](../../apps/cli/src/analyze.ts):
  - If `git status` fails or times out, `undefined !== ""` yields `workingTreeDirty: true`.
  - Analysing a subdirectory of a larger repo records the outer repo's SHA.
  - `git` runs inside the analysed repo, so a hostile `.git/config` (for example `core.fsmonitor`) can execute commands. That conflicts with NFR-5.
- **Actions:**
  - [x] Treat a failed status as unknown (`undefined`), not dirty.
  - [x] Record commit metadata only when the analysed path is the git top level, or record the relative path.
  - [x] Run git with config overrides that disable command execution (for example `-c core.fsmonitor=false`), or read `.git` directly.

### P3: Cleanup and hardening

All P3 items are read only unless noted. All are addressed; notes on the choices are inline.

#### R17. Error handling

- [x] Replace silent `catch {}` in [module-resolver.ts](../../packages/code-analysis/src/module-resolver.ts) (manifest and file reads) and `runGitCommand` with diagnostics or typed handling.
  - Resolver: a config or manifest file that exists but cannot be read now yields a `FILE_READ_FAILED` warning. The `catch` is gone because `ts.sys.readFile` returns `undefined` instead of throwing.
  - Git: `runGitCommand` returns a typed result. A missing binary or a non-repository (exit 128) is expected and silent. Anything else becomes a warning returned from `analyzeRepository` and printed by the CLI. It is deliberately not a snapshot diagnostic, so `contentHash` does not depend on git behaviour.
- [x] Surface a duplicate workspace package name (the Map is keyed by name) as a diagnostic (`WORKSPACE_PACKAGE_NAME_DUPLICATE`). Imports resolve to the first directory in path order, in both the resolver and the pipeline.

#### R18. Dead and duplicated code

- [x] Merge the nearly identical `parsePackageTsConfig` and `parseTsConfigs` bodies (already merged into `parseTsConfigFile` by the P2 work).
- [x] Remove the dead `fileImport as { resolvedFilePath? }` cast in the graph code.
- [x] Share the `EXCLUDED_DIRECTORY_NAMES` list. The analyser code already shares `repository-files.ts`. The standalone benchmark script `generate-reference-edges.mjs` keeps its own copy on purpose, so the reference stays independent of the analyser.

#### R19. Hashing and output details

- [x] Normalise CRLF before hashing, or document the behaviour. CRLF is normalised to LF before hashing (ADR-0004 addendum).
- [x] Decide whether `loc` counts a trailing newline as an extra line. It does not. This changed output, so `ENGINE_VERSION` is `0.3.0` and the golden hash was updated.
- [x] Write the snapshot atomically (temp file, then rename).

#### R20. Type and schema drift

- [x] Guard against drift between the zod schemas and the domain interfaces. The schema `satisfies z.ZodType<ArchitectureSnapshot>` and a type test asserts the reverse direction. Verified by temporarily changing a domain field type, which failed typecheck.

#### R21. ESLint

- [x] Per-package `no-restricted-imports` overrides replace the global `@archmind/*/src/**` pattern, and app blocks set it to `off`. The deep-import pattern is now repeated in every block and the app blocks enforce it. Relative cross-package imports are rejected by `no-restricted-syntax` blocks generated per directory depth (up to 8 levels below a package root).
- [x] Consider type-aware linting. `no-floating-promises`, `no-misused-promises` and `await-thenable` are enabled for `{apps,packages}/*/src/**`. The codebase had no violations.

#### R22. CI ([ci.yml](../../.github/workflows/ci.yml))

- [x] Run on `push` to the main branch as well as `pull_request`.
- [x] Add `permissions: contents: read` and pin actions (to commit SHAs with the version in a comment).
- [x] Add an `engines` field or `.nvmrc` (both; CI reads `.nvmrc`).
- [x] Add a Prettier check script (`pnpm format:check`). It is not a CI step yet: 37 existing files fail it and need a repository-wide `pnpm format` first.
- [x] Add the CLI build and smoke step (see R5). The CLI runs through the pinned `tsx`, so there is no build. The smoke step already existed.

#### R23. Benchmark documentation

- [x] Record repository commit SHAs, machine specs, engine version and memory use in [m1-resolution-benchmark.md](../development/m1-resolution-benchmark.md). The SHAs recorded earlier for vitest and vscode did not match the clones and were corrected.
- [x] The "reference tool" is `ts.resolveModuleName`, so agreement is partly circular. Compared two repositories against `dependency-cruiser@18.8.0` (100% on changesets, 92.98% on vitest, differences explained in the benchmark doc).

#### R24. Prepare for self-analysis in M3

- [x] `apps/cli/fixtures/**` will be analysed when ArchMind checks itself. Plan an exclude mechanism: an `analysis.exclude` glob list in `archmind.config.json`, planned under M3.3 in [BACKLOG.md](../BACKLOG.md). Not implemented yet.

## Acceptance criteria versus evidence

| AC | Status | Related items |
| --- | --- | --- |
| M1.8: identical `contentHash` across runs and directories, "covered by tests" | **Not met.** No end-to-end test, and verified failures with absolute-path diagnostics and with a different locale | R1, R2, R3 |
| M1.9: fixtures "with expected graphs" | Tests assert selected edges only. No golden graphs | R1, R15 |
| M1.2 / M1.8: "every file has exactly one owning component" validated | Partially validated | R13 |
| M1.5: "supports … project references" | Verified: a solution-style tsconfig with `references` resolves a path alias in the referenced package, but only because every tsconfig is parsed independently. There is no reference handling, diagnostic or test | New test needed |
| M1.3: "respects `.gitignore`" | Root file only (verified: nested `.gitignore` ignored) | R11 |
| M1.9: `archmind analyze` CLI | Works via `tsx`, but the built `bin` fails to start (verified) | R5 |
| M1.9: unresolved ≤ 2% and agreement ≥ 95% on two monorepos | Met according to the recorded results (not re-run), with a thin margin and a partly circular reference tool | R9, R23 |

## Suggested order of work

1. **Determinism:** R2, R3, R1.
2. **Shared graph logic:** R4, before M2 and M3 build on it.
3. **Structure and run path:** R6, R5.
4. **Medium items** before the explorer (R7 to R16). The explorer will surface ghost components, missing symbols and dropped edges.
5. **Cleanup** (R17 to R24) opportunistically.
