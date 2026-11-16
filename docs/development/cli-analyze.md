# ArchMind CLI (`archmind analyze`)

This guide explains how to run the local analysis CLI introduced in M1.9.

## Prerequisites

From the repository root:

```bash
pnpm install
pnpm --filter @archmind/cli build
```

## Analyze a repository

Run:

```bash
pnpm dlx tsx apps/cli/src/main.ts analyze <path> --out <snapshot.json> [--format snapshot|summary]
```

### Required arguments

- `<path>`: absolute or relative path to the repository you want to analyze
- `--out <snapshot.json>`: file path where the snapshot JSON will be written

### Optional arguments

- `--format snapshot` (default): writes the snapshot file only
- `--format summary`: writes the snapshot file and prints a human-readable summary to stdout

## Examples

Analyze the current repository and print summary output:

```bash
pnpm dlx tsx apps/cli/src/main.ts analyze . --out ./tmp/archmind-snapshot.json --format summary
```

Analyze another local repository:

```bash
pnpm dlx tsx apps/cli/src/main.ts analyze /absolute/path/to/repo --out /absolute/path/to/snapshot.json
```

## Related benchmark command

For resolution-quality and performance benchmark instructions, see [m1-resolution-benchmark.md](./m1-resolution-benchmark.md).
