# M1 Resolution Benchmark

This document records M1 benchmark evidence for:

- **NFR-8** (resolution quality): unresolved rate `<= 2%` and agreement `>= 95%`
- **NFR-7** (performance): `< 2 minutes` on a repository with at least 5,000 analysable files

## Benchmark setup

- ArchMind analyzer command: `analyze <repo> --out <snapshot.json>`
- Reference-edge generator: [generate-reference-edges.mjs](../../apps/cli/scripts/generate-reference-edges.mjs)
  - Uses TypeScript module resolution (`ts.resolveModuleName`) as an external reference implementation for internal file edges.
- Benchmark runner: `resolution-benchmark`
- Date: 2026-11-17 (re-run after the P2 review fixes; the 2026-11-16 results are superseded)
- Engine version: `0.2.0`, parser (TypeScript) `5.9.3`
- Machine: Apple M4, 16 GB RAM, macOS (arm64), Node.js v24
- Repositories, shallow clones at: `vitest-dev/vitest@4e905a1`, `changesets/changesets@9a035ec`, `microsoft/vscode@6b7ba7e`

## How to reproduce

1. Install dependencies (no separate build step is needed):

   ```bash
   pnpm install
   ```

2. Generate reference edges (example):

   ```bash
   node apps/cli/scripts/generate-reference-edges.mjs /path/to/repo /path/to/reference-edges.json
   ```

3. Run the benchmark:

   ```bash
   pnpm archmind resolution-benchmark --config /path/to/resolution-benchmark.config.json
   ```

4. For NFR-7, measure a large repository run:

   ```bash
   /usr/bin/time -p pnpm archmind analyze /path/to/large-repo --out /tmp/large.snapshot.json --format summary
   ```

## Results

### NFR-8 (open-source monorepos)

| Repository | Files | Duration (ms) | Unresolved rate | Agreement | Unresolved <= 2% | Agreement >= 95% |
| --- | ---: | ---: | ---: | ---: | :---: | :---: |
| vitest-dev/vitest | 2,430 | 1,664 | 0.99% | 95.02% | ✅ | ✅ |
| changesets/changesets | 164 | 172 | 0.00% | 100.00% | ✅ | ✅ |

### NFR-7 (performance)

| Repository | Files | Duration (seconds) | Target (< 120s when files >= 5,000) |
| --- | ---: | ---: | :---: |
| microsoft/vscode | 14,876 | 22.49 | ✅ |

## Notes on the 2026-11-17 re-run

- **Unresolved rate now counts `#` specifiers and excludes assets.** Unresolvable `#` imports are in the rate, and relative imports of non-code files (`./styles.css`, `./a.json`) are classified `asset` and are in neither the numerator nor the denominator. Without the `#` fallback below, vitest would have measured 2.43%, over the 2% target.
- **`#` imports whose `imports` target leaves the package are resolved.** vitest has `"#test-utils": "../test-utils/index.ts"` (74 imports). TypeScript rejects such targets, so the resolver falls back to resolving the target relative to the owning `package.json`.
- **Agreement is Jaccard similarity against a TypeScript-only reference** (`ts.resolveModuleName`). The extra `#test-utils` edges are correct but absent from the reference, which lowered vitest's agreement from 97.5% to 95.02%. The margin over the 95% target is thin, and the cause is a reference limitation, not a resolution error.
- **vscode is about three times faster (68.11s to 22.49s).** The resolver now uses a precomputed directory index and tsconfig-by-file index instead of scanning every file per lookup. The hardware behind the earlier figure was not recorded, so only the order of magnitude is comparable.
- A 12,000-file linear import chain (previously a stack overflow in cycle detection) analyses in about 2.6s.
