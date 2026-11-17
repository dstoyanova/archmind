# M1 Resolution Benchmark

This document records M1 benchmark evidence for:

- **NFR-8** (resolution quality): unresolved rate `<= 2%` and agreement `>= 95%`
- **NFR-7** (performance): `< 2 minutes` on a repository with at least 5,000 analysable files

## Benchmark setup

- ArchMind analyzer command: `analyze <repo> --out <snapshot.json>`
- Reference-edge generator: [generate-reference-edges.mjs](../../apps/cli/scripts/generate-reference-edges.mjs)
  - Uses TypeScript module resolution (`ts.resolveModuleName`) as an external reference implementation for internal file edges.
- Benchmark runner: `resolution-benchmark`
- Date: 2026-11-17 (re-run after the code review fixes; the 2026-11-16 results are superseded)
- Engine version: `0.3.0`, parser (TypeScript) `5.9.3`
- Machine: Apple M4, 16 GB RAM, macOS 27.2 (arm64), Node.js v24.22.3
- Repositories, shallow clones at these commits (read from each clone's `HEAD`):
  - `vitest-dev/vitest@efba8cbfe94b1402a7ccab8a73994cb389cffa4d`
  - `changesets/changesets@9a035ec36045aeb6141dd0bbac9ab9e3c69ac0bc`
  - `microsoft/vscode@acd59dfb9bb53d358aad7c546ed16a92fc09a075`
- Independent comparison tool: `dependency-cruiser@18.8.0` (see [Independent comparison](#independent-comparison)).
- Memory is the peak resident set size reported by `/usr/bin/time -l`.

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

4. For NFR-7, measure a large repository run. `/usr/bin/time -l` prints the peak memory on macOS (use `-v` on Linux):

   ```bash
   /usr/bin/time -l pnpm archmind analyze /path/to/large-repo --out /tmp/large.snapshot.json --format summary
   ```

## Results

### NFR-8 (open-source monorepos)

| Repository            | Files | Duration (ms) | Unresolved rate | Agreement | Unresolved <= 2% | Agreement >= 95% |
| --------------------- | ----: | ------------: | --------------: | --------: | :--------------: | :--------------: |
| vitest-dev/vitest     | 2,430 |         1,852 |           0.99% |    95.02% |        ✅        |        ✅        |
| changesets/changesets |   164 |           190 |           0.00% |   100.00% |        ✅        |        ✅        |

Peak memory of the whole `resolution-benchmark` run over both repositories (one process): 472 MiB.

### NFR-7 (performance)

| Repository       |  Files | Duration (seconds) | Peak memory | Target (< 120s when files >= 5,000) |
| ---------------- | -----: | -----------------: | ----------: | :---------------------------------: |
| microsoft/vscode | 14,846 |              25.37 |   2.1 GiB   |                 ✅                  |

### Independent comparison

The reference edges above come from `ts.resolveModuleName`, the engine the analyser itself uses, so that agreement figure is partly circular. As a second opinion the same `internal-file` edge sets were compared with `dependency-cruiser@18.8.0` (`--no-config --ts-pre-compilation-deps`, run from a temporary directory so it is not a repository dependency). The comparison script is not part of the repository.

| Repository            | ArchMind edges | dependency-cruiser edges | Agreement (Jaccard) |
| --------------------- | -------------: | -----------------------: | ------------------: |
| changesets/changesets |            217 |                      217 |             100.00% |
| vitest-dev/vitest     |          2,590 |                    2,522 |              92.98% |

On vitest the 186 differing edges are explained by tool limits, not by resolution errors:

- **124 edges only ArchMind reports** are `~/` alias imports (55) and `#` imports (69) that dependency-cruiser did not apply. The tsconfig could not be passed because its `lib` list is newer than the TypeScript bundled with dependency-cruiser, and `package.json` `imports` are not followed.
- **3 further edges only ArchMind reports** are relative imports.
- **59 edges only dependency-cruiser reports** are 33 relative imports, mostly of `context` that dependency-cruiser resolves to `context.js` while TypeScript resolves them to `context.d.ts` (a declaration file, excluded from analysis), 20 `@vitest/*` workspace imports that dependency-cruiser resolves to a stub at the package root while ArchMind follows the `__vitest_source__` export condition to `src/`, and 6 others not investigated.

On vitest this is below the 95% agreement target, so it is recorded as evidence of known resolver differences and is not an NFR gate.

## Notes on the 2026-11-17 re-run

- **Unresolved rate now counts `#` specifiers and excludes assets.** Unresolvable `#` imports are in the rate, and relative imports of non-code files (`./styles.css`, `./a.json`) are classified `asset` and are in neither the numerator nor the denominator. Without the `#` fallback below, vitest would have measured 2.43%, over the 2% target.
- **`#` imports whose `imports` target leaves the package are resolved.** vitest has `"#test-utils": "../test-utils/index.ts"` (74 imports). TypeScript rejects such targets, so the resolver falls back to resolving the target relative to the owning `package.json`.
- **Agreement is Jaccard similarity against a TypeScript-only reference** (`ts.resolveModuleName`). The extra `#test-utils` edges are correct but absent from the reference, which lowered vitest's agreement from 97.5% to 95.02%. The margin over the 95% target is thin, and the cause is a reference limitation, not a resolution error.
- **vscode is about three times faster (68.11s to 25.37s on the final run).** The resolver now uses a precomputed directory index and tsconfig-by-file index instead of scanning every file per lookup. The hardware behind the earlier figure was not recorded, so only the order of magnitude is comparable.
- A 12,000-file linear import chain (previously a stack overflow in cycle detection) analyses in about 2.6s.
- **Commit SHAs corrected.** The SHAs recorded earlier for vitest and vscode did not match the clones the benchmark used; the values above were read from the clones.
