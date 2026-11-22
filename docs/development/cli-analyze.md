# ArchMind CLI (`analyze` and `check`)

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

- **Configuration errors.** The CLI validates the config root and `analysis` only. Unknown root keys (including a misspelling of `rules`) and invalid analysis fields stop the run. An invalid `rules` section does not stop analysis or affect snapshot hashes. Rule configuration is described in [ADR-0006](../adr/ADR-0006-governance-rules-and-evaluations.md).
- **Source exclusions.** Set `analysis.exclude` to globs such as `["apps/cli/fixtures/**"]`. Globs match repository-relative paths with `/` separators. Matching source files are not analysed, but import resolution still recognises them and reports `IMPORT_TARGET_EXCLUDED`. Resolution metadata such as package manifests and TypeScript configs is not excluded by this setting.
- **Nested folders.** `analysis.nestedFolders` lists repository-relative folders, such as `["packages/vitest/src/node"]`, whose immediate subfolders also become child components. Their sibling folders stay components, unlike a deeper `componentRoots` entry. An entry that is not a folder component is ignored with `CONFIG_NESTED_FOLDER_UNKNOWN`.
- **Git metadata.** Commit SHA, branch, commit time and the dirty flag are recorded only when `<path>` is the top level of a git work tree. For a subdirectory of a larger repository no commit metadata is recorded, because the commit describes a different scope. A missing git binary or a non-repository records nothing silently. If git fails in another way, for example a timeout, the CLI prints a `Warning:` line to stderr and the run continues; these warnings are not stored in the snapshot, so its `contentHash` does not depend on git. The dirty flag is omitted when `git status` fails. Git runs with `core.fsmonitor` disabled so that the analysed repository's git configuration cannot run commands.
- **Snapshot file.** The snapshot is written to a temporary file next to `--out` and renamed, so a failed run never leaves a partial file.
- **Line endings and `loc`.** File hashes ignore CRLF versus LF, so an `autocrlf` checkout gives the same `sourceHash`. `loc` counts logical lines: a trailing newline does not add one.
- **Diagnostics.** Warnings are stored in the snapshot. `IMPORT_TARGET_EXCLUDED` means an import points at a file that exists but was left out of the analysis. `CONFIG_COMPONENT_PARENT_UNKNOWN` and `CONFIG_COMPONENT_PARENT_CYCLE` mean a configured component was attached to the root. `WORKSPACE_ENTRY_UNMAPPED` means an import of a workspace package could not be mapped to an analysed source file, for example an export that points at build output (`vitest/config`) or a non-code subpath such as `package.json`; the import counts as resolved but records no dependency. `PACKAGE_MANIFEST_INVALID` means a `package.json` could not be read. `FILE_READ_FAILED` means a `package.json` or `tsconfig*.json` that exists could not be read during module resolution. `WORKSPACE_PACKAGE_NAME_DUPLICATE` means several workspace packages declare the same name; imports of that name resolve to the first directory in path order.
- **Import resolution.** Relative imports of non-code files (`./styles.css`, `./data.json`) are counted as `asset` and are not part of the unresolved rate. Unresolvable `#` imports are part of it.

## Related benchmark command

For resolution-quality and performance benchmark instructions, see [m1-resolution-benchmark.md](./m1-resolution-benchmark.md).

## Check governance rules

Analyze the repository and evaluate its rules:

```bash
pnpm archmind check . --format summary --fail-on error
```

Without `--snapshot`, `check` writes `archmind.snapshot.json` in the working directory. By default it writes the evaluation next to the snapshot by appending `.evaluation.json` to its full filename. `--out <evaluation.json>` overrides the evaluation path. `--format summary` prints counts by severity and rule, baseline comparison when requested, and snapshot analysis coverage. The default `--format evaluation` writes the document without a summary.

To apply current rules to an existing snapshot without re-analyzing:

```bash
pnpm archmind check . --snapshot ./tmp/snapshot.json \
  --baseline ./tmp/baseline.evaluation.json --new-only --format summary
```

The repository path selects the config; it defaults to the working directory when `--snapshot` is supplied. Snapshot reuse verifies the schema version and `contentHash`. Changes to `analysis` produce a warning; the check still uses the stored graph and metrics. Rules come from the current config. `--new-only` requires `--baseline` and filters the exit-code decision, not the evaluation JSON or summary totals.

| Code | Meaning                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| `0`  | No findings at or above the selected severity.                                                             |
| `1`  | A finding reaches `--fail-on error` (default) or `--fail-on warning` (counts warnings and errors).         |
| `2`  | Tool or configuration error, including invalid snapshots, baselines, or rule selectors that match nothing. |

The CLI writes the evaluation before reporting violations or rule diagnostics. Use a separate path for a baseline you want to keep.
