# M1 Resolution Benchmark

This document records M1 benchmark evidence for:

- **NFR-8** (resolution quality): unresolved rate `<= 2%` and agreement `>= 95%`
- **NFR-7** (performance): `< 2 minutes` on a repository with at least 5,000 analysable files

## Benchmark setup

- ArchMind analyzer command: `analyze <repo> --out <snapshot.json>`
- Reference-edge generator: [generate-reference-edges.mjs](../../apps/cli/scripts/generate-reference-edges.mjs)
  - Uses TypeScript module resolution (`ts.resolveModuleName`) as an external reference implementation for internal file edges.
- Benchmark runner: `resolution-benchmark`
- Date: 2026-11-16

## How to reproduce

1. Build the CLI app:

   ```bash
   pnpm --filter @archmind/cli build
   ```

2. Generate reference edges (example):

   ```bash
   node apps/cli/scripts/generate-reference-edges.mjs /path/to/repo /path/to/reference-edges.json
   ```

3. Run the benchmark:

   ```bash
   pnpm dlx tsx apps/cli/src/main.ts resolution-benchmark --config /path/to/resolution-benchmark.config.json
   ```

4. For NFR-7, measure a large repository run:

   ```bash
   /usr/bin/time -p pnpm dlx tsx apps/cli/src/main.ts analyze /path/to/large-repo --out /tmp/large.snapshot.json --format summary
   ```

## Results

### NFR-8 (open-source monorepos)

| Repository | Files | Duration (ms) | Unresolved rate | Agreement | Unresolved <= 2% | Agreement >= 95% |
| --- | ---: | ---: | ---: | ---: | :---: | :---: |
| vitest-dev/vitest | 2,430 | 1,832 | 1.94% | 97.74% | ✅ | ✅ |
| changesets/changesets | 164 | 161 | 0.73% | 100.00% | ✅ | ✅ |

### NFR-7 (performance)

| Repository | Files | Duration (seconds) | Target (< 120s when files >= 5,000) |
| --- | ---: | ---: | :---: |
| microsoft/vscode | 14,838 | 68.11 | ✅ |
