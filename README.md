# ArchMind

**Make software architecture observable, understandable and continuously improvable.**

ArchMind reads the source code of a TypeScript or JavaScript repository, builds a model of its components and the dependencies between them, and lets you explore that model in the browser and check it against architecture rules.

## What works today

- **Analyse** a local repository from the command line and save the result as a snapshot file. No dependencies need to be installed in the analysed repository.
- **Explore** snapshots in a browser: a component graph you can expand level by level, dependency evidence down to the import line, file graphs, search and filters.
- **Govern** with rules: forbid dependencies, enforce layers, ban cycles, cap coupling and restrict packages. Findings show up in the explorer and can fail your CI.
- **Compare** the findings of two runs to see what is new, still there or resolved.

Not built yet: connecting GitHub, user accounts, a database, and the AI assistant (see [Roadmap](./docs/ROADMAP.md)).

## Contents

1. [Set up](#1-set-up)
2. [Quick start: analyse a repository and explore it](#2-quick-start-analyse-a-repository-and-explore-it)
3. [Tour of the explorer](#3-tour-of-the-explorer)
4. [Check architecture rules](#4-check-architecture-rules)
5. [Configure ArchMind for your repository](#5-configure-archmind-for-your-repository)
6. [CLI reference](#6-cli-reference)
7. [Local API](#7-local-api)
8. [Troubleshooting](#8-troubleshooting)
9. [Development](#9-development)
10. [About the project](#10-about-the-project)

## 1. Set up

You need:

- **Node.js 22 or newer** (`node --version`; `.nvmrc` pins 22).
- **pnpm 10** (`pnpm --version`). If you don't have it, run `corepack enable`, and pnpm is installed at the version this repository pins.
- **git**, only to clone this repository.

```bash
git clone https://github.com/dstoyanova/archmind.git
cd archmind
pnpm install
```

There is no build step. The CLI and the development servers run straight from the TypeScript sources.

All commands in this guide run from the repository root. Paths are resolved from the directory you run a command in. The folder `tmp/` is ignored by git, so it is a good place for generated files.

## 2. Quick start: analyse a repository and explore it

This analyses ArchMind itself. Use any other local repository by replacing `.` with its path.

**Step 1. Create a folder for snapshots.**

```bash
mkdir -p tmp/snapshots
```

**Step 2. Analyse the repository.**

```bash
pnpm archmind analyze . --out ./tmp/snapshots/archmind.json --format summary
```

This writes a _snapshot_: one JSON file with the components, files, imports, dependencies, metrics and cycles of the repository. The summary printed to the terminal looks like this:

```text
Snapshot written.
- components: 17
- dependencies: 34
- cycles: 1 (runtime: 0, type-only: 1)
- resolution unresolved rate: 0.00%
- diagnostics: 0 (errors: 0, warnings: 0)
```

Analysing the same files again gives the same snapshot hash, wherever the repository is checked out.

**Step 3. Start the explorer.**

```bash
ARCHMIND_SNAPSHOT_DIR="$PWD/tmp/snapshots" pnpm dev --filter @archmind/api --filter @archmind/web
```

This starts two local servers: the API on `http://127.0.0.1:3001` (reads your snapshot folder) and the web explorer on `http://127.0.0.1:3000`. Use an **absolute** path for `ARCHMIND_SNAPSHOT_DIR`. Wait until the terminal shows both are ready (about 20 seconds the first time).

**Step 4. Open [http://127.0.0.1:3000](http://127.0.0.1:3000).** You should see the **Architecture explorer** with `archmind.json` selected and a graph of components. Press `Ctrl+C` in the terminal to stop the servers.

Next, take the [tour of the explorer](#3-tour-of-the-explorer).

## 3. Tour of the explorer

### Choose a snapshot

The **Snapshot** menu lists every valid snapshot file in your snapshot folder. After you add a file while the explorer is open, click **Refresh snapshots**. Your selection and the state of the graph are kept unless the selected snapshot disappeared. Files that cannot be used (invalid JSON, a snapshot over 16 MiB, or a content hash that does not match) are listed with the reason instead of being shown.

The **Theme** menu follows your system by default. Pick **Light** or **Dark** to override it, or **System** to follow your device again.

### Snapshot overview

Click **Snapshot overview** to see what the snapshot is (creation time, engine and parser versions, source and content hashes) and how well the analysis could resolve imports:

- **Unresolved imports** is the share of imports ArchMind could not map to a file or package.
- **Import resolution** counts imports by kind (internal file, workspace package, external package, Node.js built-in, asset) and says which of them can become a dependency in the graph. A low unresolved rate does not mean every import became an edge.
- **Diagnostics** lists warnings from the analysis, such as `WORKSPACE_ENTRY_UNMAPPED`. See [Diagnostics](#diagnostics).

### Read the graph

Each box is a component, a package or a folder of the repository. Arrows are dependencies: an arrow from A to B means code in A imports code in B. Components are grouped hierarchically.

- **Expand and collapse.** Components with children have an **Expand** button. Their children appear inside them and dependencies are redrawn between the visible components. A collapsed component stands for everything under it. You can expand up to 128 components at once.
- **Cycles.** Components in a dependency cycle get a red border and a **Cycle** tag. Cycles that exist only through `import type` have a dashed purple border and a **Type** tag.
- **Zoom and pan** with the mouse or the controls in the corner. **Fit View** shows everything.

### Filter what you see

The panel on the left controls the view:

| Control                                               | What it does                                                                                                                                                    |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Find a component**                                  | Search by name or path. Choosing a result expands the graph to it and highlights it.                                                                            |
| **Internal dependencies** / **External dependencies** | Show or hide arrows between components, and arrows to npm packages.                                                                                             |
| **Include type-only imports**                         | Count `import type` statements as dependencies or not.                                                                                                          |
| **Import source roles**                               | Which files' imports count: `source` (always on), `test`, `story`, `script`, `config`. By default only production code is shown.                                |
| **Show components without files in these roles**      | Components that have no file in the selected roles (for example a package with only tests) are hidden unless a dependency ends at them. Tick this to show them. |

**Show component list** replaces the graph with a text list of the visible components, with their paths, level and **Details**, **Expand** and **Collapse** buttons. It is useful with a screen reader or when the graph is too dense. Use **Show component graph** to switch back.

### Inspect a component

Click a component name to open its details:

- **Metrics:** file count, lines of code, fan-in (components that depend on it), fan-out (components it depends on) and instability. Metrics describe the production graph at the component's own level and don't change with the filters.
- **Child components**, **External dependencies**, and the **Files in component subtree**.
- **Dependency evidence:** pick a dependency to see every import behind it, with file, line, column and the import text.
- **Open file graph** shows the files of that component and how they import each other. **Back to component graph** returns.

If several components share a name (for example two components called `pre`), labels include their path so you can tell them apart.

## 4. Check architecture rules

A _rule_ describes something that must hold in your architecture. ArchMind evaluates rules against a snapshot and produces an _evaluation_: a list of _findings_, each with a message, a severity (`error` or `warning`) and the import statements that prove it.

Two rules are always on unless you turn them off:

- `archmind/no-cycles` (error): no dependency cycles between components. Cycles that only exist in test files or through `import type` are ignored.
- `archmind/high-coupling` (warning): a leaf component (one with no child components) depends on more than 10 other components.

You add your own rules in `archmind.config.json` ([how](#rules)). The repository ships a small demo project that breaks every kind of rule, which is the easiest way to see how this works.

### Walkthrough: find and fix violations

**Step 1. Copy the demo project.**

```bash
cp -R apps/cli/fixtures/governance tmp/demo-repo
```

**Step 2. Analyse it and check its rules.**

```bash
pnpm archmind analyze tmp/demo-repo --out ./tmp/snapshots/demo-before.json
pnpm archmind check tmp/demo-repo --snapshot ./tmp/snapshots/demo-before.json --format summary
```

You get the findings that fail the check, and the command exits with code `1`:

```text
- findings: 3 error(s), 3 warning(s)
- findings that fail the check (3):
  - [error] archmind/no-cycles: Dependency cycle involving src/ui; src/data. (src/data/index.ts:1:1)
  - [error] forbid-data-to-ui: Forbidden dependency from src/data to src/ui. (src/data/index.ts:1:1)
  - [error] layers: src/data (layer "data") depends on src/ui (higher layer "ui"). (src/data/index.ts:1:1)
```

The evaluation is saved next to the snapshot as `tmp/snapshots/demo-before.json.evaluation.json`.

**Step 3. Fix the code, analyse again, and compare with the first run.**

```bash
echo 'export const data = "data";' > tmp/demo-repo/src/data/index.ts
pnpm archmind analyze tmp/demo-repo --out ./tmp/snapshots/demo-after.json
pnpm archmind check tmp/demo-repo --snapshot ./tmp/snapshots/demo-after.json \
  --baseline ./tmp/snapshots/demo-before.json.evaluation.json --format summary
```

The summary now says `baseline: 0 new, 2 existing, 4 resolved`. With `--new-only` added, only _new_ findings decide the exit code. This is how you adopt rules on a codebase that already has violations: take today's evaluation as the baseline, and fail the build only on findings you introduce from now on.

**Step 4. Look at the findings in the explorer.** Start it as in [step 3 of the quick start](#2-quick-start-analyse-a-repository-and-explore-it), or reload the page if it is already running. The explorer finds new evaluation files when the page loads.

1. Choose the snapshot **demo-before.json**.
2. Scroll to **Governance findings** and choose its evaluation. The entry shows the number of findings, a short hash of the rules, and the engine version.
3. Read **Evaluation health**: counts by severity and rule, the components with most findings, and the analysis coverage (see [Diagnostics](#diagnostics)). Badges with a number appear on the graph.
4. Click a finding, for example `forbid-data-to-ui`. Its detail shows the message and the evidence (file, line, column and import text).
5. Click **Show on graph**. The explorer expands the graph to the components involved, applies the roles and type-only setting the rule used, and draws the reported dependency as a thick line. **Jump to evidence** scrolls to the evidence list.
6. Use **All severities**, **All rules** and **All statuses** to filter the list. The badges on the graph follow the same filters.

To see what changed since the first run, open **demo-after.json**, choose its evaluation, and under it choose the baseline evaluation **demo-before.json.evaluation.json** (set **Baseline snapshot** to `demo-before.json`). Every finding is now marked `new`, `existing` or `resolved`, and the **Status** filter is enabled. Resolved findings come from the baseline; **Show on graph** opens them in the baseline snapshot.

What else the findings panel tells you:

- **Rule problems.** If a rule could not be evaluated, for example because a selector matches no component, a red alert lists it above the findings. The rule produced no results; this does not mean the code is clean.
- **Comparison notes.** Next to the new and resolved counts the explorer says when rules, hierarchy or governance engine version changed between the two evaluations, since those changes can add or remove findings without any code change. It also warns when a baseline shares no component with the current evaluation, which usually means it belongs to another project.
- **Invalid evaluations.** An evaluation file that is damaged, too large (16 MiB), or refers to components or files that its snapshot does not have is listed with the reason instead of being shown.

### Use it in CI

```bash
pnpm archmind analyze . --out ./tmp/snapshot.json
pnpm archmind check . --snapshot ./tmp/snapshot.json --format summary --fail-on error
```

The job fails when the exit code is not `0`. ArchMind's own CI does exactly this; its rules live in [archmind.config.json](./archmind.config.json) and complement the ESLint import restrictions.

## 5. Configure ArchMind for your repository

Put an `archmind.config.json` in the root of the analysed repository. Without one, defaults apply. The file has two optional sections, and unknown keys are rejected so a typo is never silently ignored:

```json
{
  "analysis": {},
  "rules": {}
}
```

### Analysis

`analysis` changes what the snapshot contains. Changing it requires analysing again.

```json
{
  "analysis": {
    "componentRoots": { "apps/api": "src/modules" },
    "nestedFolders": ["packages/vitest/src/node"],
    "components": [
      { "name": "payments", "paths": ["src/billing/**", "src/invoices/**"], "parent": "shop" }
    ],
    "fileRoles": { "test": ["**/*.spec.ts"] },
    "exclude": ["apps/cli/fixtures/**", "**/generated/**"]
  }
}
```

| Key              | Purpose                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `componentRoots` | For a package directory, the folder inside it whose subfolders become its child components. `"apps/api": "src/modules"` turns every folder in `apps/api/src/modules` into a component.                 |
| `nestedFolders`  | Folders whose immediate subfolders also become child components, while the folder's siblings stay components.                                                                                          |
| `components`     | Components you define yourself: a `name`, one or more `paths` (globs) and an optional `parent`. Use them for architectural units that don't match the folder structure. Rules can select them by name. |
| `fileRoles`      | Glob patterns that classify files as `test`, `story`, `script` or `config`. Everything else is `source`. The defaults recognise common names such as `*.test.ts`, `*.stories.*` and `scripts/**`.      |
| `exclude`        | Globs of files that are not analysed at all (fixtures, generated code). Imports that point into excluded files are reported as `IMPORT_TARGET_EXCLUDED`.                                               |

By default, a repository is analysed as a hierarchy: the repository root, then each workspace package (from `pnpm-workspace.yaml` or the `workspaces` field of `package.json`), then folders. Every file belongs to exactly one component. [ADR-0005](./docs/adr/ADR-0005-hierarchical-hybrid-component-model-and-file-roles.md) explains when each setting helps.

### Rules

`rules` changes what is checked. Changing rules does **not** require analysing again: run `archmind check --snapshot` against the existing snapshot.

```json
{
  "rules": {
    "disableDefaults": ["archmind/high-coupling"],
    "definitions": [
      {
        "id": "domain-is-independent",
        "type": "forbidden-dependency",
        "severity": "error",
        "from": [{ "path": "packages/domain" }],
        "to": [{ "path": "packages/!(domain)" }]
      }
    ]
  }
}
```

Every rule has a unique `id`, a `type` and a `severity` (`error` or `warning`). The prefix `archmind/` is reserved for the built-in rules. Renaming a rule makes its old findings resolved and its new findings new.

| Type                   | What it checks                                                                                                                           | Fields                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `forbidden-dependency` | Components matching `from` must not depend on components matching `to`.                                                                  | `from`, `to`                                                                         |
| `layers`               | Layers are listed from highest to lowest. A layer may depend on itself and on any layer below it, never on one above.                    | `layers: [{ name, components }]`                                                     |
| `no-cycles`            | No dependency cycles, optionally only among selected components.                                                                         | `components` (optional), `includeTypeOnlyCycles`                                     |
| `threshold`            | A stored metric of each selected component stays at or below `max`.                                                                      | `components`, `metric` (`fileCount`, `loc`, `fanIn`, `fanOut`, `instability`), `max` |
| `restricted-package`   | Only the `allow` components may import the listed packages. Use `node:fs` to name a Node.js built-in. An empty `allow` forbids everyone. | `packages`, `allow`                                                                  |

**Selectors** pick components in two ways. `{ "path": "apps/api/src/modules/*" }` matches components by repository-relative path, with globs. `{ "name": "payments" }` matches a component you defined in `analysis.components`. A selector matches the component and everything below it. If a selector matches nothing, the rule is reported as not evaluated rather than silently passing.

**Scope.** Dependency and cycle rules look at production code (`source` files) and include type-only imports by default. Add a `scope` to change this:

```json
{ "scope": { "additionalFileRoles": ["test"], "includeTypeOnly": false } }
```

Threshold rules always use the stored production metrics and have no scope.

**Known limit.** An import of a workspace package that cannot be mapped to a source file (for example because the package exports build output) is recorded against the package, not a file. Rules about folders inside that package cannot see it. That is why the explorer shows analysis coverage next to the findings.

The full design is in [ADR-0006](./docs/adr/ADR-0006-governance-rules-and-evaluations.md).

## 6. CLI reference

Run the CLI with `pnpm archmind <command>`.

### `analyze`

```bash
pnpm archmind analyze <path> --out <snapshot.json> [--format snapshot|summary]
```

| Argument                | Meaning                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `<path>`                | Repository to analyse (absolute or relative). Required.                                            |
| `--out <snapshot.json>` | Where to write the snapshot. Required. Written atomically, so a failed run leaves no partial file. |
| `--format snapshot`     | Default. Writes the file only.                                                                     |
| `--format summary`      | Writes the file and prints a summary.                                                              |

### `check`

```bash
pnpm archmind check [<path>] [--snapshot <snapshot.json>] [--out <evaluation.json>]
  [--format summary|evaluation] [--fail-on error|warning] [--baseline <evaluation.json> [--new-only]]
```

| Argument               | Meaning                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<path>`               | Repository whose `archmind.config.json` supplies the rules. Without `--snapshot`, it is analysed first and the snapshot is written to `archmind.snapshot.json` in the current directory. |
| `--snapshot <file>`    | Evaluate an existing snapshot without analysing again. Its schema version and content hash are verified. If `analysis` in the config changed since, a warning says to analyse again.     |
| `--out <file>`         | Where to write the evaluation. Default: the snapshot path plus `.evaluation.json`.                                                                                                       |
| `--format summary`     | Print counts by severity and rule, the findings that decide the exit code (up to 20, with their first import location), the baseline comparison, and analysis coverage.                  |
| `--format evaluation`  | Default. Only writes the file. When the exit code is `1`, one line on stderr says how many findings failed.                                                                              |
| `--fail-on <severity>` | `error` (default): only errors fail. `warning`: warnings fail too.                                                                                                                       |
| `--baseline <file>`    | An earlier evaluation to compare with. Findings become new, existing or resolved.                                                                                                        |
| `--new-only`           | With `--baseline`: only new findings decide the exit code and are listed.                                                                                                                |

The evaluation is always written before the result is reported. Use a different `--out` for a baseline you want to keep.

**Exit codes**

| Code | Meaning                                                                                                                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | No finding at or above the selected severity.                                                                                                      |
| `1`  | At least one finding reaches `--fail-on` (and is new, with `--new-only`).                                                                          |
| `2`  | Tool or configuration error: invalid snapshot, baseline or config, or a rule that could not be evaluated, such as a selector that matches nothing. |

A comparison tells you when the rules, the hierarchy settings or the governance engine version differ between the two evaluations ("rules changed", "hierarchy changed", "engine changed"). The CLI warns when the baseline shares no component with the current findings.

### Behaviour notes

- **Configuration errors.** `analyze` validates the config root and `analysis` only. An invalid `rules` section does not stop it, and does not change snapshot hashes. `check` validates everything.
- **Git metadata.** Commit, branch, commit time and the uncommitted-changes flag are recorded only when `<path>` is the top level of a git work tree. A subdirectory of a bigger repository records none, because the commit would describe a different scope. Git runs with `core.fsmonitor` disabled so the analysed repository's git configuration cannot run commands. Git metadata is not part of the content hash.
- **Reproducibility.** Line endings do not change the source hash, and `loc` counts logical lines.
- **Imports.** Relative imports of non-code files (`./styles.css`, `./data.json`) count as `asset` and are not part of the unresolved rate.
- **Analysed files.** `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs`. Declaration files (`.d.ts`) and generated files are skipped, and the root `.gitignore` is respected.

### Diagnostics

Warnings from the analysis are stored in the snapshot and shown in the overview.

| Code                                                               | Meaning                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKSPACE_ENTRY_UNMAPPED`                                         | An import of a workspace package could not be mapped to an analysed source file, for example an export that points at build output (`vitest/config`) or a non-code subpath such as `package.json`. It counts as resolved but records no dependency. |
| `IMPORT_TARGET_EXCLUDED`                                           | An import points at a file that exists but is excluded from the analysis.                                                                                                                                                                           |
| `CONFIG_COMPONENT_PARENT_UNKNOWN`, `CONFIG_COMPONENT_PARENT_CYCLE` | A configured component's `parent` is unknown or circular, so it was attached to the root.                                                                                                                                                           |
| `CONFIG_NESTED_FOLDER_UNKNOWN`                                     | A `nestedFolders` entry is not a folder component and was ignored.                                                                                                                                                                                  |
| `PACKAGE_MANIFEST_INVALID`, `FILE_READ_FAILED`                     | A `package.json` or `tsconfig*.json` could not be read.                                                                                                                                                                                             |
| `WORKSPACE_PACKAGE_NAME_DUPLICATE`                                 | Several workspace packages have the same name. Imports of that name resolve to the first directory in path order.                                                                                                                                   |

Rule problems are reported separately, per evaluation: `SELECTOR_NO_MATCH` (a selector matches no component), `AMBIGUOUS_LAYER` (a component belongs to two layers) and `BUILT_IN_MODULE_NAME` (a bare built-in such as `fs` where `node:fs` is required).

### Benchmarks

`archmind resolution-benchmark` measures import-resolution quality and speed on large repositories. See [performance and quality evidence](./docs/ARCHITECTURE.md#performance-and-quality-evidence) for the config format, results and the explorer rendering budgets.

## 7. Local API

The explorer talks to a read-only API that serves the snapshot and evaluation files in `ARCHMIND_SNAPSHOT_DIR`. Run it alone with:

```bash
ARCHMIND_SNAPSHOT_DIR="$PWD/tmp/snapshots" pnpm dev --filter @archmind/api
```

Open [Swagger UI](http://127.0.0.1:3001/api/docs) to browse and try the endpoints: snapshots, graph projections, component details, dependency evidence, evaluations, findings (with an optional baseline), highlights and health.

| Setting                 | Meaning                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `ARCHMIND_SNAPSHOT_DIR` | Required. Absolute path of the folder with `*.json` snapshots and `*.evaluation.json` evaluations.     |
| `PORT`                  | API port. Default `3001`.                                                                              |
| `ARCHMIND_API_ORIGIN`   | For the web app: where the API is, if not `http://127.0.0.1:3001`. Must be a loopback address.         |
| `ARCHMIND_WEB_ORIGIN`   | Allows browser requests from one exact origin, such as `http://localhost:3000`. CORS is off otherwise. |

The API listens only on `127.0.0.1`, serves files by opaque IDs from the directory listing, ignores symbolic links and refuses files over 16 MiB. It is a local development service, not an authenticated deployment.

For a production bundle of the API, run `pnpm build --filter @archmind/api`, then `ARCHMIND_SNAPSHOT_DIR="$PWD/tmp/snapshots" pnpm --filter @archmind/api start`.

## 8. Troubleshooting

| Symptom                                                             | Likely cause and fix                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The API stops with `Set ARCHMIND_SNAPSHOT_DIR…`                     | The variable is missing, or the path does not exist or is not a folder. Use an absolute path.                                                                                        |
| The explorer says **No snapshots found**                            | The folder has no `*.json` snapshot. Run `archmind analyze … --out <folder>/name.json`, then click **Refresh snapshots**.                                                            |
| A snapshot is listed as **Invalid**                                 | Read the reason: broken JSON, over 16 MiB, unsupported version, or a content hash that no longer matches (the file was edited). Analyse again.                                       |
| **No evaluations for this snapshot**                                | Evaluations are linked to snapshots by content hash, not by file name. Put the `.evaluation.json` in the same folder, generated from this exact snapshot, and reload the page.       |
| A port is in use                                                    | Set `PORT` for the API (and `ARCHMIND_API_ORIGIN` for the web app). Next.js uses the next free web port and prints it; make sure the API port and `ARCHMIND_API_ORIGIN` still match. |
| `Check failed: …` with exit code `2`                                | Read the message: invalid config (it names the rule and field), a snapshot whose hash does not match, a baseline that is not an evaluation, or a rule selector that matches nothing. |
| `Warning: Current analysis configuration differs from the snapshot` | You changed `analysis` after taking the snapshot. The check used the stored graph. Analyse again to apply the change.                                                                |
| A finding's **Show on graph** says the scope is not recorded        | The evaluation is from an older version. Run `archmind check --snapshot <snapshot.json>` again.                                                                                      |
| Many unresolved imports or missing edges                            | Open **Snapshot overview**. Look at the diagnostics and the resolution counts; path aliases and workspace packages need a `tsconfig.json` or `package.json` in the repository.       |

## 9. Development

```bash
pnpm lint          # ESLint, all packages
pnpm typecheck     # TypeScript, all packages
pnpm test          # Vitest, all packages
pnpm format:check  # Prettier (CI runs this); `pnpm format` rewrites files
```

Browser tests use Playwright. Build the API and web app first, then run them:

```bash
pnpm --filter @archmind/api build
pnpm --filter @archmind/web build
pnpm --filter @archmind/web exec playwright install chromium   # once
pnpm --filter @archmind/web test:e2e
```

The tests generate their own fixtures. The CLI governance fixtures in `apps/cli/fixtures/` are analyser inputs, not test suites.

**Repository layout**

| Path                           | Role                                                                  |
| ------------------------------ | --------------------------------------------------------------------- |
| `apps/cli`                     | The `archmind` command (`analyze`, `check`).                          |
| `apps/api`                     | Read-only explorer API (NestJS).                                      |
| `apps/web`                     | Explorer UI (Next.js, React Flow, shadcn/ui).                         |
| `packages/domain`              | Core types, graph projection, cycle detection, evaluation comparison. |
| `packages/contracts`           | zod schemas: snapshot, config, rules, evaluation, API.                |
| `packages/code-analysis`       | Source discovery, parsing and import resolution.                      |
| `packages/architecture-engine` | Builds the component hierarchy, metrics, cycles and the snapshot.     |
| `packages/governance-engine`   | Evaluates rules against a snapshot.                                   |
| `packages/analysis-pipeline`   | Composes the engines for a local repository.                          |
| `packages/config`              | Shared ESLint, Prettier, TypeScript and Vitest configuration.         |

More: [architecture](./docs/ARCHITECTURE.md), [product](./docs/PRODUCT.md), [roadmap](./docs/ROADMAP.md), [backlog](./docs/BACKLOG.md), [implementation plan](./docs/plans/mvp-implementation-plan.md) and [decision records](./docs/adr).

## 10. About the project

### Vision

Give engineering teams a continuously updated understanding of their software architecture, from code structure and dependencies to architectural health and governance.

### Core capabilities

- **System Explorer**: explore components, dependencies and system structure.
- **Architecture Governance**: define and evaluate architectural rules and principles.
- **Change Impact Analysis**: understand the architectural impact of code changes. _Planned._
- **Architecture Health**: identify coupling, complexity and architectural risks.
- **AI Architecture Assistant**: ask questions, explore trade-offs and get evidence-based recommendations. _Planned._

### Planned MVP

The first version focuses on TypeScript repositories: connect a GitHub repository, analyse it, build the architecture model and dependency graph, visualise it, identify basic risks, and answer questions with evidence. The local analysis, explorer and governance described in this guide are the first milestones (M1 to M3) of that plan.

### Technology

TypeScript, Next.js and React, NestJS, React Flow, the TypeScript Compiler API, zod, pnpm workspaces and Turborepo. Planned: PostgreSQL with Prisma, LangGraph.js.
