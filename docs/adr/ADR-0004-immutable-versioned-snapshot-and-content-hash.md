# ADR-0004: immutable, versioned snapshots with reproducible contentHash

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

ArchMind's analysis engine must produce deterministic facts before any AI interpretation.
Snapshots are reused across CLI and service flows, and need to support idempotency, deduplication and reliable comparisons over time.

## Problem

We need a snapshot design that:

1. Is immutable and versioned.
2. Produces the same identity for the same source-derived analysis in any checkout.
3. Keeps source metadata available without polluting deterministic identity.

## Considered alternatives

1. **Versioned immutable snapshots with a source-derived `contentHash`.**
2. Mutable snapshots keyed only by repository and branch.
3. Hashing full documents including environment and metadata fields.

## Decision

Adopt immutable, versioned snapshots and compute `contentHash` from normalized, source-derived analysis content only.

`contentHash` input includes:

- `engineVersion`
- `parserVersion`
- `analysisConfigHash`
- `components`
- `files`
- `symbols`
- `fileImports`
- `dependencies`
- `cycles`
- `diagnostics`
- `resolutionStats`

Normalization rules:

- All repository paths are repo-relative POSIX paths.
- Collections are sorted deterministically before hashing.
- IDs are deterministic from stable source-derived values.

`contentHash` explicitly excludes:

- Repository identity and absolute paths.
- Commit SHA, branch and commit timestamp.
- Snapshot creation timestamp and other runtime metadata.

## Consequences

### Positive

- Same source produces the same `contentHash` across checkouts and execution environments.
- Snapshot deduplication is safe and predictable.
- Re-analysis and retries remain idempotent.

### Negative

- Requires strict canonicalization rules in analysis output.
- Any schema changes that affect hashed fields need explicit version and migration handling.

## Addendum (2026-11-17): canonical serialisation and ordering

The original decision required "normalized" content and "deterministic" sorting without defining them. The M1 review found that locale-dependent sorting and host-specific diagnostic text broke the guarantee. The rules below make the specification precise. They refine this decision and do not change it.

- **Canonical JSON.** Hashed content is serialised with `canonicalJson` from `@archmind/domain`: no whitespace, object keys sorted by code unit order at every depth, properties with `undefined` values omitted, non-finite numbers rejected. Array order is preserved, so every collection is sorted by its producer before hashing. This one helper is used for `contentHash`, `analysisConfigHash` and `sourceHash`.
- **Ordering.** Every sort that feeds snapshot output or a hash uses `compareStrings` from `@archmind/domain` (UTF-16 code unit order). `String.prototype.localeCompare` is not used, because its result depends on the process locale and ICU build.
- **Diagnostics are hashed.** Diagnostic messages must not contain absolute paths, host names or operating system and parser error text that varies by environment. Paths are repo-relative, and paths outside the repository are replaced by `<outside-repository>`.
- **Reproducibility tests.** The CLI test suite analyses one fixture twice, in two directories, and with a diagnostic present, and asserts equal `contentHash` values.

## Addendum (2026-11-17): source hash inputs, file discovery and verification

- **`sourceHash` inputs.** The local idempotency key `repository + sourceHash + engineVersion` must change whenever the analysis result could. `sourceHash` is the canonical-JSON hash of the content hash of every analysed file, the content hash of every resolution-relevant file, and the analysis configuration. Resolution-relevant files are every `package.json`, every `tsconfig*.json` and `pnpm-workspace.yaml` that file discovery reaches. A tsconfig that a discovered tsconfig `extends` under another name is not covered.
- **File discovery.** Files are discovered in code unit order. Every `.gitignore` applies to its own subtree, and a nested file takes precedence over an outer one. `.git`, `node_modules`, `coverage` and `.next` are skipped at any depth. `dist`, `build` and `out` are skipped only directly under the repository root or a package root, so a source folder such as `src/build/` is analysed.
- **Single read.** Each analysed file is read once. The same bytes feed the content hash, the line count and parsing, so the hash cannot drift from the parsed text.
- **Excluded import targets.** An import that resolves to a file the analysis left out (ignored, generated, oversized or a declaration file) produces an `IMPORT_TARGET_EXCLUDED` warning. It is never dropped silently.
- **Engine version.** `ENGINE_VERSION` lives in `@archmind/architecture-engine`. A golden-snapshot test in `@archmind/analysis-pipeline` fails when the `contentHash` of a fixed repository changes, so output changes cannot ship without a version bump.
- **Verification on read.** `verifyContentHash(snapshot)` recomputes the hash so a snapshot read from disk or the database can be checked for tampering or corruption. `validateSnapshotInvariants` checks referential integrity: component IDs, parent and depth consistency, import, symbol and evidence references, and cycle members.
