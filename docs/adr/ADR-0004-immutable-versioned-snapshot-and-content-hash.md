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
