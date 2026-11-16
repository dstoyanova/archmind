# M1 Resolution Benchmark

This document tracks M1 benchmark results for:

- **NFR-8** (resolution quality): unresolved rate `<= 2%` and agreement `>= 95%`.
- **NFR-7** (performance): `< 2 minutes` for repositories with at least 5,000 files.

## How to run

1. Build the CLI app:

   ```bash
   pnpm --filter @archmind/cli build
   ```

2. Create a benchmark config from [resolution-benchmark.config.example.json](./resolution-benchmark.config.example.json).

3. Run:

   ```bash
   node apps/cli/dist/main.js resolution-benchmark --config <your-config.json>
   ```

## Reference edge format

Each `referenceEdgesPath` file must be JSON and can contain either:

- `{"from":"relative/path.ts","to":"relative/path.ts"}` objects, or
- `"from/path.ts->to/path.ts"` strings.

## Latest recorded run

| Repository | Files | Duration (ms) | Unresolved rate | Agreement | Unresolved <= 2% | Agreement >= 95% | NFR-7 (<2 min @ >=5000 files) |
| --- | ---: | ---: | ---: | ---: | :---: | :---: | :---: |
| pending | — | — | — | — | — | — | — |
