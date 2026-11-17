# ArchMind CLI (`archmind analyze`)

This guide explains how to run the local analysis CLI introduced in M1.9.

## Prerequisites

From the repository root:

```bash
pnpm install
```

The CLI runs directly from TypeScript sources through the pinned `tsx` dev dependency, so there is no build step. Paths you pass are resolved relative to the directory you run the command from.

## Analyze a repository

Run:

```bash
pnpm archmind analyze <path> --out <snapshot.json> [--format snapshot|summary]
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
pnpm archmind analyze . --out ./tmp/archmind-snapshot.json --format summary
```

Analyze another local repository:

```bash
pnpm archmind analyze /absolute/path/to/repo --out /absolute/path/to/snapshot.json
```

## Behaviour notes

- **Configuration errors.** An invalid `archmind.config.json` stops the run with one line per problem, for example `- analysis.components: Expected array, received string`. Unknown keys are errors.
- **Git metadata.** Commit SHA, branch, commit time and the dirty flag are recorded only when `<path>` is the top level of a git work tree. For a subdirectory of a larger repository no commit metadata is recorded, because the commit describes a different scope. The dirty flag is omitted when `git status` fails. Git runs with `core.fsmonitor` disabled so that the analysed repository's git configuration cannot run commands.
- **Diagnostics.** Warnings are stored in the snapshot. `IMPORT_TARGET_EXCLUDED` means an import points at a file that exists but was left out of the analysis. `CONFIG_COMPONENT_PARENT_UNKNOWN` and `CONFIG_COMPONENT_PARENT_CYCLE` mean a configured component was attached to the root. `PACKAGE_MANIFEST_INVALID` means a `package.json` could not be read.
- **Import resolution.** Relative imports of non-code files (`./styles.css`, `./data.json`) are counted as `asset` and are not part of the unresolved rate. Unresolvable `#` imports are part of it.

## Related benchmark command

For resolution-quality and performance benchmark instructions, see [m1-resolution-benchmark.md](./m1-resolution-benchmark.md).
