# ADR-0005: Hierarchical hybrid component model and file-role classification

- **Status:** Accepted
- **Date:** 2026-11-16

## Context

ArchMind must provide useful architecture boundaries on first run, even when a repository has no custom configuration.
At the same time, teams need to adapt inferred boundaries to their real domain structure without rewriting the analysis engine.
The model must remain deterministic and guarantee that each file maps to exactly one owning component.

## Problem

We need a component-mapping approach that:

1. Works out of the box for single-package and monorepo repositories.
2. Supports explicit overrides for known architectural boundaries.
3. Keeps file-role and import-role semantics consistent for graphing, cycles and governance.
4. Produces deterministic ownership suitable for immutable snapshots.

## Considered alternatives

1. **Hierarchical hybrid model with configuration overrides and deterministic ownership.**
2. Flat package-only component model.
3. Fully manual component model requiring configuration for all repositories.

## Decision

Adopt a **hierarchical hybrid component model** with deterministic ownership priority:

1. Configured components from `archmind.config.json` (`analysis.components`) have highest priority.
2. Workspace packages become depth-1 components.
3. Immediate folders under each package component root become depth-2 components.
   - Default component root is `src/` when present, otherwise the package directory.
   - `analysis.componentRoots` may override the component root per package (for example, NestJS modules under `src/modules`).
4. Files outside packages map to `<root>`.

Every file must have exactly one owning component: the deepest matched component after applying the priority order above.

File roles are classified deterministically as `source`, `test`, `story`, `script` or `config` using defaults that can be overridden by `analysis.fileRoles`.

## Consequences

### Positive

- Useful architecture mapping without mandatory configuration.
- Supports domain-specific boundaries through explicit overrides.
- Preserves deterministic, repeatable ownership for snapshot hashing and invariants.
- Aligns explorer, governance and cycle analysis on a shared ownership model.

### Negative

- Inference may not match all repositories without configuration tuning.
- Depth-2 folder inference can produce noisy components in highly mixed directory layouts.
- Requires careful documentation so users understand ownership priority and override behavior.

## Addendum (2026-11-17): configuration rules

- **Strict schema.** `analysis`, `analysis.fileRoles` and each configured component reject unknown keys, so a typo such as `componentRoot` is an error and not silently ignored. `source` is the fallback role and cannot be overridden in `fileRoles`. Component names must be unique.
- **Normalised keys.** `componentRoots` keys and values are normalised (`./apps/api/` becomes `apps/api`), and two keys that normalise to the same path are rejected.
- **Stable IDs.** A configured component's ID is derived from its name (`configured:<name>`), not its position in the array, so reordering the configuration does not rename components. Baselines depend on this.
- **Parent diagnostics.** A configured `parent` that names no configured component, or that sits on a parent cycle, produces a `CONFIG_COMPONENT_PARENT_UNKNOWN` or `CONFIG_COMPONENT_PARENT_CYCLE` warning, and the component is attached to the root.
- **Nested packages.** Folder components are built only from files owned by the package itself. Files owned by a nested package never create folders in an outer package.

## Addendum (2026-11-20): source exclusions

- **`analysis.exclude`** is an optional list of non-empty glob patterns. Discovery skips source files matching any pattern against the repository-relative POSIX path, including dotfiles. The patterns are additive; leading `!` does not re-include files.
- The list is included in `analysisConfigHash` and `sourceHash` when supplied. Excluded source bytes do not enter `sourceHash`; resolution metadata such as `package.json` and `tsconfig*.json` still does. Omitting the setting preserves existing hashes.
- Exclusions do not hide files from import resolution. Imports into omitted source files produce `IMPORT_TARGET_EXCLUDED`.

## Addendum (2026-11-20): nested folder components

- **Problem.** Setting `componentRoots` deeper (Vitest `packages/vitest` at `src/node`) exposes the subfolders of that folder but makes every other folder under `src` (`runtime`, `utils` and so on) part of the package component. This was observed in the M2.7 validation on Vitest.
- **`analysis.nestedFolders`** is an optional list of repository-relative folder paths, for example `["packages/vitest/src/node"]`. Each entry must name a folder component, either a depth-2 folder or one created by an earlier entry. Its immediate subfolders become child folder components one level deeper, and all sibling folders stay. Entries apply shallowest first, so `["a/src/x", "a/src/x/y"]` creates two further levels.
- Ownership is unchanged: a file belongs to the deepest matching folder component within its package. Files directly in a listed folder stay with that folder. Folders owned by a nested package never create components in the outer package.
- An entry that names no folder component produces a `CONFIG_NESTED_FOLDER_UNKNOWN` warning and is ignored.
- The value is normalised like `componentRoots`, and duplicates are rejected. It is included in `analysisConfigHash` when supplied; omitting it preserves existing hashes. Component IDs stay `folder:<path>`, so they do not change when the setting is added.
- The component depth limit of 2 in the decision above is therefore a default, not a maximum.
