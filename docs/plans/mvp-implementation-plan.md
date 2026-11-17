# ArchMind — MVP Implementation Plan

**Status:** Draft (revision 2; see [§11 Revision history](#11-revision-history))
**Last updated:** 2026-11-15

This plan turns the [product overview](../PRODUCT.md) and [technical architecture](../ARCHITECTURE.md) into concrete requirements, a target architecture and an incremental delivery sequence.

- The milestone overview lives in the [roadmap](../ROADMAP.md).
- Task-level breakdown with acceptance criteria lives in the [backlog](../BACKLOG.md).

## 1. Delivery strategy

ArchMind is built **analysis-first**. The deterministic analysis engine is both the core product value and the biggest technical risk, so it is built and validated first.

**Governance follows directly after the explorer**, while everything still runs locally. This answers the MVP question *"what should I be concerned about?"* before any investment in persistence, authentication, tenancy or hosting.

Platform concerns come next, in this order: persistence and background processing, then GitHub with multiple users and a hosted staging environment, then AI.

Every milestone ends with a **working, demoable product**. No milestone consists only of infrastructure.

| Milestone | Name                                | Working product at the end                                                           |
| --------- | ----------------------------------- | ------------------------------------------------------------------------------------ |
| M1        | Local analysis CLI                  | `archmind analyze ./repo` produces an architecture snapshot and summary.             |
| M2        | Local architecture explorer         | Browse any analysed repository as an interactive, hierarchical graph in the browser. |
| M3        | Local governance                    | `archmind check` and the explorer show rule violations and risks, with evidence.     |
| M4        | Persistent analysis service         | Analyse repositories in the background, with history and new/resolved findings.      |
| M5        | GitHub, teams and staging           | Teammates sign in on a hosted staging environment and explore private repositories.  |
| M6        | AI architecture assistant           | Ask questions about the architecture and get answers that cite evidence.             |
| M7        | Beta                                | A production, monitored product with comparison and onboarding, ready for pilots.    |

## 2. Key decisions

| Decision                | Choice                                                                                                       | Rationale                                                                                                     | ADR      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | -------- |
| Architecture style      | Modular monolith in a pnpm + Turborepo monorepo                                                               | Clear boundaries without distributed-system overhead.                                                         | ADR-0001 |
| Delivery order          | Analysis-first; local governance before platform; AI last                                                     | Validates core value before platform investment. Gives the AI deterministic facts and findings to rely on.     | ADR-0002 |
| CLI application         | New `apps/cli`                                                                                                | Fastest feedback loop. Reused for local checks and CI.                                                         | ADR-0002 |
| Schemas and validation  | zod for the snapshot format, config file and API contracts, with a NestJS integration and OpenAPI generation | One schema source for CLI, API, worker and web. Replaces NestJS's default class-validator approach.            | ADR-0003 |
| Snapshot format         | Versioned, immutable snapshot with a reproducible, source-derived `contentHash`                               | Same source gives the same hash in any checkout, from the CLI or GitHub. Enables deduplication.               | ADR-0004 |
| Component model         | Hierarchical and hybrid: inferred from packages and folders, overridable via `archmind.config.json`          | Useful with zero configuration. Shows boundaries inside packages, not only between them.                      | ADR-0005 |
| Governance              | Declarative rules evaluated by a pure engine into immutable **rule evaluations** that own findings            | Rule or engine changes never require re-analysis or mutation of a snapshot.                                    | ADR-0006 |
| Background jobs         | Postgres-backed queue (pg-boss) behind a `JobQueue` interface; analysis runs in an isolated child process   | No extra infrastructure. Enforceable timeouts and memory caps. Credentials kept away from untrusted input.    | ADR-0007 |
| Snapshot storage        | Relational core (components, dependencies, findings) plus a compressed snapshot document per unique `contentHash` | Keeps queries simple while bounding storage growth as push-triggered analysis lands.                          | ADR-0008 |
| Authentication          | **Clerk** (email and password, plus Sign in with GitHub) _preferred, pending ADR-0009_. GitHub App for repository access | Avoids building sessions, password reset and OAuth. Repository access still needs its own GitHub App flow (see §4.13). | ADR-0009 |
| Tenancy and sharing     | Workspace is the isolation and sharing boundary. Repository linking requires the user's own GitHub access     | Clear, testable isolation. Prevents users from linking repositories they cannot read.                         | ADR-0010 |
| Hosting                 | Docker Compose locally; minimal hosted staging in M5; production in M7. **Neon** for managed Postgres _under consideration_ | GitHub callbacks and webhooks need public URLs, and real users need a shared environment. Neon is plain PostgreSQL, so it stays a hosting choice. | ADR-0011 |
| UI components           | **shadcn/ui** (Radix and Tailwind), copied into `apps/web`                                                    | Reuse accessible, pre-built components instead of building them from scratch.                                  | None     |
| ORM                     | **Prisma** (retained). Drizzle was considered and rejected on 2026-11-16                                      | Already assumed throughout the plan. Do not re-propose an ORM change without new evidence.                     | None     |
| LLM provider and data   | Provider-agnostic (LangChain chat model interface). AI is opt-in per workspace and never receives file contents | Avoids lock-in. Makes data sharing an explicit, informed owner decision.                                      | ADR-0012 |

Decisions that change architectural boundaries, add major dependencies or touch auth/tenancy require human approval before implementation (see §9).

## 3. Product requirements

### 3.1 Users and core jobs

| User                        | Core job in the MVP                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| Software architect          | Understand the actual structure and dependencies, and check intended layering.              |
| Principal or staff engineer | Find cycles, highly coupled components and boundary violations before they spread.         |
| Engineering manager or head | Get an evidence-backed view of architectural health and risk.                               |

The MVP must answer: **"What does my software architecture look like, and what should I be concerned about?"**

Change-frequency ("churn") hotspots need Git history, so they are deferred until after beta (§8).

### 3.2 Functional requirements

The **M** column gives the milestone in which each requirement is delivered.

#### Analysis (FR-A)

| ID     | Requirement | M |
| ------ | ----------- | - |
| FR-A1  | Discover TypeScript/JavaScript source files (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`). Respect `.gitignore`. Exclude `node_modules`, build output, `.d.ts` and generated files. | M1 |
| FR-A2  | Classify each file's role as `source`, `test`, `story`, `script` or `config`, using default patterns that `archmind.config.json` can override (§4.7). | M1 |
| FR-A3  | Extract imports with their kind: `static`, `re-export`, `dynamic` (literal `import()`), `require` (literal) or `type-only` (§4.7). | M1 |
| FR-A4  | Extract exported symbol declarations (functions, classes, interfaces, types, enums, variables) with source locations. | M1 |
| FR-A5  | Resolve imports **without installing dependencies or building the repository**, using the strategy in §4.6. Classify each import as internal file, workspace package, external package, Node built-in or unresolved. Record resolution statistics in the snapshot. | M1 |
| FR-A6  | Group files into a **component hierarchy** (§4.5). Each file belongs to exactly one owning component. | M1 |
| FR-A7  | Build the component dependency graph. Each dependency stores its evidence (file, line, specifier) and its import counts by import kind and by file role. The graph can be projected to any hierarchy level. | M1 |
| FR-A8  | Compute metrics per component (file count, LOC, fan-in, fan-out, instability) and detect cycles at each hierarchy level and at file level. By default both use the production graph (§4.7), and cycles that exist only through type-only imports are flagged. | M1 |
| FR-A9  | Produce an immutable, versioned snapshot (§4.4). Malformed or unsupported files produce diagnostics and never abort the analysis. | M1 |
| FR-A10 | Analyse a repository from a local path (M1–M4) or from GitHub at a specific commit (M5). | M1, M5 |

#### Explorer (FR-E)

| ID    | Requirement | M |
| ----- | ----------- | - |
| FR-E1 | Show the component graph with automatic layout, zoom, pan and search. Components can be expanded and collapsed through the hierarchy. | M2 |
| FR-E2 | Highlight cycles. Filter by component, dependency kind (internal or external), import kind (show or hide type-only imports) and file role (tests hidden by default). | M2 |
| FR-E3 | Show component details: metrics, files, child components, inbound and outbound dependencies. | M2 |
| FR-E4 | Show dependency evidence as the list of importing file locations. | M2 |
| FR-E5 | Drill down from a component to its file-level graph. | M2 |
| FR-E6 | Link evidence to the exact line on GitHub, pinned to the analysed commit. | M5 |

#### Governance (FR-G)

| ID    | Requirement | M |
| ----- | ----------- | - |
| FR-G1 | Declare rules in the `rules` section of `archmind.config.json`: layer ordering, forbidden dependencies, no cycles, metric thresholds and restricted external packages. Rules can target components at any hierarchy level. | M3 |
| FR-G2 | Run built-in default rules when no rules are configured: no cycles between components, and high-coupling warnings. | M3 |
| FR-G3 | Evaluating rules against a snapshot creates an immutable **rule evaluation**. Each of its findings records the rule ID and version, severity, message, evidence, and a fingerprint that stays stable across snapshots. | M3 |
| FR-G4 | By default, rules apply to the production graph. Each rule can opt in to test files or type-only imports. | M3 |
| FR-G5 | Compare an evaluation with a baseline evaluation to mark findings as new, existing or resolved. Locally the baseline is explicit (M3); in the service it is selected automatically (§4.9, M4). | M3, M4 |
| FR-G6 | Show findings in a list and highlight them on the graph. Show a health summary per snapshot. | M3 |
| FR-G7 | `archmind check` evaluates rules locally. It exits non-zero when violations exceed a severity threshold, optionally counting only violations that are new against a baseline. | M3 |

#### Repositories and analysis runs (FR-R)

| ID    | Requirement | M |
| ----- | ----------- | - |
| FR-R1 | Register repositories. In M4 this is a local path, enabled only in development mode. From M5 repositories come from a GitHub installation. | M4, M5 |
| FR-R2 | Trigger an analysis that runs in the background, and show its status (queued, running, succeeded, failed) and its diagnostics. | M4 |
| FR-R3 | List snapshot history per repository and open any past snapshot. | M4 |
| FR-R4 | Analysing identical source with the same engine version reuses the existing snapshot. For GitHub, identical source means the same commit; for local repositories, the same file contents, including uncommitted changes. A change only to rules or to the governance engine creates a new rule evaluation without re-analysis. | M4 |
| FR-R5 | Each repository has a tracked branch (the default branch), which is used to select baselines. | M4 |
| FR-R6 | Compare two snapshots: added or removed components and dependencies, metric changes, new or resolved findings. | M7 |
| FR-R7 | Optionally analyse automatically on push to the tracked branch. | M7 |

#### Identity, workspaces and sharing (FR-I)

| ID    | Requirement | M |
| ----- | ----------- | - |
| FR-I1 | Sign in and sign out with GitHub. | M5 |
| FR-I2 | Create a personal workspace automatically on first sign-in. Users can belong to several workspaces, with the role owner or member. | M5 |
| FR-I3 | Workspace owners invite teammates by GitHub username. An invitation is a single-use link that expires after 7 days and can only be accepted by the invited GitHub account. Owners can remove members and change their roles. | M5 |
| FR-I4 | Workspace owners link a GitHub App installation and select repositories. A user can link only repositories they can access on GitHub. Access is checked when the repository is linked and again each time that user triggers an analysis. | M5 |
| FR-I5 | Workspace members can view the architecture data of every repository in the workspace, whatever their own GitHub access. The UI states this when a repository is connected. | M5 |
| FR-I6 | When a repository is removed from the installation or the App is uninstalled, the repository becomes `disconnected`. No new analyses run, existing data stays readable, and owners can delete it. | M5 |
| FR-I7 | Every workspace-owned resource is accessible only to members of that workspace. | M5 |

#### AI assistant (FR-AI)

| ID     | Requirement | M |
| ------ | ----------- | - |
| FR-AI1 | AI features are disabled per workspace until an owner enables them, after being shown which data is sent to which provider (§4.12). | M6 |
| FR-AI2 | Ask natural-language questions about a selected snapshot in a chat panel. Agent progress (steps and tools used) streams live. The answer is shown once its citations have been validated. | M6 |
| FR-AI3 | Every claim in an answer cites components, dependencies, files or findings. Each citation is a clickable link into the explorer. | M6 |
| FR-AI4 | When the evidence is insufficient, the assistant says so rather than guessing. | M6 |
| FR-AI5 | Each finding has an "Explain this finding" action. | M6 |
| FR-AI6 | Conversations are saved per workspace and snapshot, and deleted together with the workspace. | M6 |

### 3.3 Non-functional requirements

| ID     | Area               | Requirement |
| ------ | ------------------ | ----------- |
| NFR-1  | Reproducibility    | `contentHash` covers only source-derived analysis content: components, files, symbols, imports, dependencies, cycles, diagnostics and resolution statistics. Paths are repo-relative POSIX paths. It also includes `engineVersion`, `parserVersion` and `analysisConfigHash`. It excludes repository identity, absolute paths, commit SHA, branch and timestamps. The same files produce the same hash in any checkout directory and whether analysed by the CLI or from a GitHub tarball. |
| NFR-2  | Versioning         | Snapshots record `schemaVersion`, `engineVersion`, `parserVersion` (the TypeScript version) and `analysisConfigHash`. Rule evaluations record `governanceEngineVersion` and `rulesHash`. |
| NFR-3  | Immutability       | Published snapshots, rule evaluations and their child records are never updated. A source change creates a new snapshot; a rule or governance engine change creates a new evaluation. Finding status (new/existing/resolved) is computed when read, never stored. |
| NFR-4  | Idempotency        | Snapshot key: `repositoryId + sourceIdentity + engineVersion`. For GitHub, `sourceIdentity` is the commit SHA. For local repositories it is the `sourceHash`, a hash of the discovered files' paths and contents plus the analysis section of the config. Evaluation key: `snapshotId + rulesHash + governanceEngineVersion`. Jobs are safe to retry. |
| NFR-5  | Untrusted input    | Repository code is never executed: no package installs, no build scripts, no JavaScript config files. Module resolution reads only files inside the repository root. Analysis runs in a child process with a memory cap and a wall-clock timeout, and without database or GitHub credentials in its environment (§4.10). |
| NFR-6  | Resource limits    | Provisional and configurable. From GitHub archives only analysable source and config files are extracted. Limits: 500 MB compressed archive, 1 GB extracted, 500,000 archive entries scanned, 20,000 analysable files, 1 MB per parsed file, 2 GB memory for the analysis process, 10-minute timeout. Symlinks, hard links and special files are skipped with a diagnostic. Entries with absolute or `..` paths fail the run. Exceeding a file-level limit produces a diagnostic; exceeding an archive or run limit fails the run with a clear reason. |
| NFR-7  | Performance        | Provisional target, measured in M1: analyse a 5,000-file repository in under 2 minutes on a developer laptop. The explorer stays responsive with 300 components and 3,000 dependencies. |
| NFR-8  | Resolution quality | Each snapshot records counts per resolution class and the unresolved rate: unresolved imports divided by relative, path-alias and workspace imports. Target on the M1 benchmark repositories: an unresolved rate of at most 2%, and at least 95% agreement on internal file edges with a reference tool. |
| NFR-9  | Tenant isolation   | All tenant-owned data is reachable only through a workspace. Every route is checked server-side. Cross-tenant access is covered by automated tests. |
| NFR-10 | Secrets            | The GitHub App private key and installation tokens stay server-side, come from environment variables or a secret manager, and are never logged or sent to the browser. User-to-server tokens are encrypted at rest. |
| NFR-11 | AI isolation and data | AI processing is separate from deterministic analysis. An AI failure never affects snapshots or evaluations. AI tools are read-only and never return file contents. AI is opt-in per workspace. |
| NFR-12 | Observability      | From M4, logs are structured, carry request and run correlation IDs, and redact secrets, tokens and source content. Metrics, error monitoring and alerting follow in M7. |
| NFR-13 | Storage            | Only queryable core data is relational. Detailed analysis data is stored as one compressed document per repository and `contentHash`, so unchanged re-analyses add no detail storage. |
| NFR-14 | Accessibility      | Core flows are keyboard-navigable, and the graph has an accessible list alternative. |

## 4. Technical architecture

### 4.1 Deployable units and packages

| Unit                           | Responsibility | Introduced |
| ------------------------------ | -------------- | ---------- |
| `apps/cli`                     | `archmind analyze` and `archmind check`. Composes the analysis and governance packages. | M1 |
| `apps/api`                     | NestJS REST API with OpenAPI. Owns authentication, workspaces, repositories, runs, explorer and findings queries, and conversations. Implements `ArchitectureQueryPort`. | M2 |
| `apps/web`                     | Next.js, React, Tailwind and React Flow. Feature folders: explorer, findings, repositories, assistant, settings. | M2 |
| `apps/worker`                  | Consumes jobs and runs analysis in an isolated child process. Evaluates rules. Later, refreshes on push. | M4 |
| `packages/config`              | Shared `tsconfig`, ESLint, Prettier and Vitest configuration. | M1 |
| `packages/domain`              | Pure domain types, invariants and graph functions: component hierarchy, graph projection, cycle detection, evaluation comparison. No I/O. | M1 |
| `packages/contracts`           | zod schemas for external contracts: snapshot and evaluation documents, `archmind.config.json`, and API request/response models. | M1 |
| `packages/code-analysis`       | `SourceProvider` port and local source provider, file discovery and roles, parsing, import and symbol extraction, module resolution. | M1 |
| `packages/architecture-engine` | Component hierarchy mapping, dependency aggregation, metrics, snapshot building and hashing. | M1 |
| `packages/analysis-pipeline`   | `analyzeRepository`: composes `code-analysis` and `architecture-engine` into one local analysis run. Reused by the CLI and the M4 worker. | M1 |
| `packages/governance-engine`   | Rule semantics, rule evaluation, finding fingerprints. | M3 |
| `packages/database`            | Prisma schema, migrations, repositories and `SnapshotDocumentStore`. | M4 |
| `packages/observability`       | Logger with redaction and correlation IDs (M4). Metrics and error reporting (M7). | M4 |
| `packages/agent-runtime`       | LangGraph.js assistant, tool definitions, `ArchitectureQueryPort`, model provider adapter, citation validation. | M6 |

`GitHubSourceProvider` lives in `apps/worker` (M5), because it needs credentials and network access.

### 4.2 Dependency rules between modules

```text
apps/cli, apps/api, apps/worker ──► packages/* (public entry points only)
apps/web ──► contracts (never engines, database or agent-runtime)

code-analysis ───────┐
architecture-engine ─┤
governance-engine ───┼──► contracts ──► domain
agent-runtime ───────┤          (domain depends on no internal package)
database ────────────┤
observability ───────┘ (depends on nothing internal)
```

- The engines (`code-analysis`, `architecture-engine`, `governance-engine`) are independent of each other and may depend on `contracts` and `domain`. Apps and `analysis-pipeline` compose them.
- No package depends on an app. Packages never import each other's internals.
- **Config schema ownership:** `contracts` owns the `archmind.config.json` schema, because it is an external, versioned contract.
  - `code-analysis` and `architecture-engine` consume the analysis section (`components`, `componentRoots`, `fileRoles`).
  - `governance-engine` consumes the `rules` section and owns its semantics.
- **Shared graph logic:** graph projection, hierarchy navigation, cycle detection and evaluation comparison live in `domain`. The explorer, governance engine and agent all use this one implementation.
- **Ports:**

  | Port                                            | Defined in       | Implemented by                                                               |
  | ----------------------------------------------- | ---------------- | ---------------------------------------------------------------------------- |
  | `SourceProvider`                                | `code-analysis`  | Local file system (`code-analysis`); GitHub (`apps/worker`)                  |
  | `SnapshotReader`, `EvaluationReader`            | `apps/api`       | File-based adapters (M2–M3); database-backed adapters (M4)                   |
  | `JobQueue`                                      | `apps/api` and `apps/worker` application layer | pg-boss adapter                                     |
  | `SnapshotDocumentStore`                         | `database`       | Postgres storage (M4); object storage later                                  |
  | `ArchitectureQueryPort`                         | `agent-runtime`  | `apps/api` application query services; the agent never calls `apps/api` directly |

- **Enforcement:** ESLint import restrictions from M1. From M3, ArchMind also checks its own repository with `archmind check`.

### 4.3 Analysis pipeline

```text
[worker parent, M4+]  resolve source identity → idempotency check → (GitHub) download + safe extraction
[analysis process]
  SourceProvider (LocalFs | extracted directory)
  → discover files (ignore rules, limits) + classify file roles
  → load project config (tsconfig(s), workspace manifests, archmind.config.json) on a repository-only virtual host
  → parse each file (ts.createSourceFile, no type-checking)
  → extract imports (with kinds) + exported symbols (with line/column)
  → resolve imports (§4.6) → file graph + resolution statistics
  → map files → component hierarchy (§4.5)
  → aggregate dependencies at the owning-component level, with evidence and counts by kind and role
  → metrics + cycles per hierarchy level and file level (production graph)
  → build snapshot (sorted, deterministic IDs, contentHash)
[worker parent]       validate snapshot schema → publish atomically → enqueue evaluate-rules
[evaluate-rules]      (snapshot, rules, governanceEngineVersion) → immutable RuleEvaluation + findings
```

In M1–M3 the CLI runs the analysis stages in-process. Each stage is a pure function over the previous stage's output, apart from `SourceProvider`.

### 4.4 Snapshot model

```text
ArchitectureSnapshot
  schemaVersion, engineVersion, parserVersion, analysisConfigHash, contentHash
  source:    { kind (local|github), sourceHash, commitSha?, branch?, commitTimestamp?, workingTreeDirty? }   ← metadata, not hashed
  createdAt                                                                                                ← metadata, not hashed
  components[]:   { id, name, parentId?, depth, kind (package|folder|configured|root), paths[], metrics }
  files[]:        { id, path, componentId, role, language, loc, parseStatus }
  symbols[]:      { id, fileId, name, kind, line, column }
  fileImports[]:  { id, fromFileId, specifier, kind, resolution, toFileId?, toComponentId?, externalPackage?, line, column }
  dependencies[]: { id, fromComponentId, toComponentId, weight, countsByKind, countsByRole, evidenceImportIds[] }
  externalDependencies[]: { componentId, packageName, weight, countsByRole }
  cycles[]:       { level (depth n | file), memberIds[], typeOnly }
  resolutionStats: { countsByResolution, unresolvedRate }
  diagnostics[]:  { severity, code, message, filePath?, line? }
```

- **Dependencies** are stored between *owning* components, the deepest component that contains each file. An import of a workspace package whose entry point cannot be mapped to a file targets the package component itself (`toComponentId`).
- **Projection:** a domain function, `projectGraph(snapshot, { depth | expanded[], filters })`, produces the graph at any level of detail.
  - Each endpoint maps to its nearest visible ancestor.
  - Edges inside one visible node are dropped.
  - Weights, counts and evidence are aggregated.
- **Metrics** for a component are computed on the production graph projected at that component's depth.
- **Deterministic IDs:** a component ID is a hash of its path in the hierarchy; a file ID is a hash of its repo-relative path; and so on.
- **Invariants:** every dependency references components in the same snapshot, and every file has exactly one owning component. Domain functions validate both.

### 4.5 Component hierarchy (hybrid model)

Components form a tree. Each file belongs to exactly one **owning component**, the deepest component whose paths contain it. Default maximum depth: 2.

1. **Configured components** (highest priority). `archmind.config.json` `components` entries declare `{ name, paths: globs, parent? }`.
2. **Packages (depth 1).** Each workspace package found from `pnpm-workspace.yaml` or the `workspaces` field in `package.json` becomes a component. Files outside every package go to a `<root>` component. In a single-package repository, the folders in step 3 become depth-1 components instead.
3. **Folders (depth 2).** The immediate subdirectories of each package's *component root* become child components.
   - The default component root is the package's `src/` directory if it exists, otherwise the package directory.
   - `componentRoots` in the config sets other roots. For example, `{ "apps/api": "src/modules" }` gives one child component per bounded context.
   - Files directly in a component root stay with the parent component.

`archmind.config.json` is JSON only, validated against the zod schema in `contracts` and never executed. `analysisConfigHash` covers only its analysis section (`components`, `componentRoots`, `fileRoles`); `rulesHash` covers its `rules` section.

### 4.6 Module resolution without installation

Repositories are analysed as checked out. Nothing is installed or built, and the analysis never reads outside the repository root.

- **Virtual host.** A TypeScript `ModuleResolutionHost`/`ParseConfigHost` is backed only by the discovered repository files, package manifests and tsconfig files.
- **tsconfig files** are parsed with `ts.parseJsonConfigFileContent` on that host.
  - `extends` targets inside the repository, including workspace packages, are followed.
  - `extends` targets in uninstalled packages (e.g. `@tsconfig/node20`) are skipped with a diagnostic. Only resolution-relevant options matter: `baseUrl`, `paths`, `rootDir`, `outDir`, `moduleResolution`, `allowJs`, `references`.
  - Each file uses the nearest tsconfig that includes it. If none does, defaults apply.
- **Relative and path-alias imports** use `ts.resolveModuleName`, including `.js`-to-`.ts` substitution for NodeNext.
- **Workspace packages** are resolved through a map of package name to directory. For `pkg` or `pkg/subpath`, try in order:
  1. Map the `exports`/`main`/`module`/`types` target back to source: replace the package's `outDir` prefix with its `rootDir`, and the `.js`/`.d.ts` extension with source extensions.
  2. Try the `source` field, then `src/index.*`, then `index.*`; apply the same mapping to subpaths.
  3. Otherwise resolve to the package component without a target file. This records the diagnostic `WORKSPACE_ENTRY_UNMAPPED`, and the component edge is still correct.
- **External and built-in imports.** A bare specifier that matches no path alias or workspace package is external, and the package name is extracted. `node:` specifiers and Node's built-in module list are classified as built-in. Nothing resolves into `node_modules`.
- **Quality measurement (M1).**
  - Resolution statistics are recorded per snapshot (NFR-8).
  - A dev-only benchmark script compares internal file edges against a reference tool, run on a fully installed and built checkout of at least two open-source TypeScript monorepos.
  - Disagreements are reviewed and recorded in `docs/development/`.

### 4.7 File roles, import kinds and the production graph

- **File roles** (default patterns, overridable via `fileRoles`):
  - `test`: `*.test.*`, `*.spec.*`, `__tests__/**`, `__mocks__/**`, and `test/`, `tests/` and `e2e/` directories within a package.
  - `story`: `*.stories.*`.
  - `script`: `scripts/**`.
  - `config`: `*.config.*`, `.*rc.*`.
  - `source`: everything else.
  - Generated files are excluded entirely (FR-A1).
- **Import kinds:**
  - `static`, `re-export`, `dynamic`, `require`.
  - `type-only`: `import type`, `export type … from`, or imports where every named specifier is marked `type` and there is no default or namespace import.
- **Production graph:** imports from `source` files, including type-only imports, which are marked as such.
  - Default metrics, cycles and rules use this graph.
  - A cycle is flagged `typeOnly` when it disappears once type-only edges are removed.
  - The explorer hides tests by default and can toggle roles and type-only imports.

### 4.8 Persistence model

PostgreSQL via Prisma, introduced in M4. Every tenant-owned table is reachable from `Workspace`. Prisma models stay inside `packages/database`, and repositories map them to domain types.

| Entity | Ownership path | Notes | M |
| ------ | -------------- | ----- | - |
| `Workspace` | root | M4 seeds a default workspace. M5 adds real workspaces and the AI opt-in setting (M6). | M4 |
| `Repository` | Workspace | `sourceType` is local or github. `trackedBranch`, `status` (connected or disconnected). A GitHub repository has a unique `githubRepoId` per workspace. | M4 |
| `AnalysisRun` | Repository | Status, idempotency key, attempt, `heartbeatAt`, timings, failure reason. | M4 |
| `ArchitectureSnapshot` | Repository | Version fields, source metadata, `contentHash`, reference to its document. Immutable. | M4 |
| `Component`, `Dependency`, `Cycle` | Snapshot | Queryable core. `Dependency` stores counts plus compact evidence (file path, line, specifier, kind) as JSONB. Immutable. | M4 |
| `SnapshotDocument` | Repository | Gzip-compressed full snapshot (files, symbols, imports, diagnostics), unique on `(repositoryId, contentHash)` and shared by identical snapshots. Never shared across repositories. | M4 |
| `RuleEvaluation` | Snapshot | `rulesHash`, `governanceEngineVersion`, status, `createdAt`. Unique on `(snapshotId, rulesHash, governanceEngineVersion)`. Immutable. | M4 |
| `Finding` | RuleEvaluation | Rule ID and version, severity, message, fingerprint, evidence (JSONB). Immutable. | M4 |
| `User`, `Session`, `WorkspaceMember`, `Invitation` | — / User / Workspace / Workspace | `Session` and `Invitation` store hashed tokens with expiry. | M5 |
| `GitHubInstallation`, `GitHubUserToken` | Workspace / User | User-to-server tokens are encrypted at rest and refreshed on expiry. | M5 |
| `Conversation`, `Message` | Workspace (and Snapshot) | | M6 |
| `AgentRun`, `ToolCall` | Conversation | Provider, model, tokens, cost, latency, inputs and outputs. | M6 |

- The explorer reads the component graph, details and findings from relational tables.
- File-level graphs, symbol search and file imports come from the snapshot document, loaded through `SnapshotDocumentStore` with a bounded in-memory cache in `apps/api`.
- Retention policies follow in M7.

### 4.9 Rule evaluations and baselines

- **Evaluation.** `evaluate(snapshot, rules, governanceEngineVersion)` produces an immutable `RuleEvaluation` with its findings.
  - The CLI writes it as `<snapshot>.evaluation.json`. The service stores it relationally.
  - Rules come from `archmind.config.json` in the analysed source. For GitHub repositories, rule changes therefore arrive with new commits.
  - A governance engine upgrade re-evaluates existing snapshots without re-analysis. Locally, editing only the rules reuses the snapshot, because the rules are not part of `sourceHash`.
- **Fingerprints** hash the rule ID with the subject's component paths and dependency endpoints, not line numbers. Unrelated edits therefore do not change them.
- **Status is derived, not stored.** `compareEvaluations(base, head)` in `domain` classifies findings by fingerprint as new, existing or resolved. Computing this on read means analyses arriving out of order never require rewriting immutable records. When the two evaluations have different `rulesHash` values, the comparison is flagged `rulesChanged`.
- **Baseline selection (M4):**
  - **Tracked-branch snapshots:** the evaluation of the tracked-branch snapshot with the latest `commitTimestamp` earlier than this one. Ties are broken by analysis order. An evaluation with the same `rulesHash` is preferred.
  - **Other branches and local snapshots with uncommitted changes:** the latest tracked-branch evaluation.
  - **Explicit choice:** users can always choose a baseline (CLI `--baseline`, API `?baseline=`).
  - **Known limitation:** commit timestamps can be out of order after a rebase. Ancestry-based baselines come after beta.

### 4.10 Background processing and isolated execution

- **Queue.** Application code depends only on a `JobQueue` port (`enqueue(type, payload, { idempotencyKey })` and handler registration). The pg-boss implementation uses the same Postgres instance. A Temporal adapter can replace it later.
- **Jobs.**
  - `analyse-repository { repositoryId, ref }`:
    1. Determine the source identity.
    2. Reuse an existing snapshot if its key matches.
    3. Otherwise prepare the source, run the analysis process, validate the result and publish it in one transaction.
    4. Enqueue `evaluate-rules`.
  - `evaluate-rules { snapshotId }` creates an evaluation if none exists for the current `rulesHash` and `governanceEngineVersion`. A failure here never affects the snapshot.
- **Isolated analysis process.**
  - The worker forks a Node child process with `--max-old-space-size` set to the memory limit and a minimal environment: no `DATABASE_URL`, no tokens, no secrets.
  - The child receives a source directory and writes the snapshot to a file.
  - The parent enforces the wall-clock timeout by killing the child, then validates its output against the schema before persisting.
  - In deployed environments, containers add a second memory limit.
- **Recovery.**
  - The parent updates `AnalysisRun.heartbeatAt` every 30 seconds.
  - A scheduled reaper marks `running` runs with a heartbeat older than 5 minutes as `failed (WORKER_LOST)` and re-enqueues them within the retry budget.
  - This is safe because publishing is atomic and idempotent.
- **Policy.**
  - Bounded retries with exponential backoff.
  - Limited worker concurrency.
  - Temporary directories are always cleaned up.
  - Status: `queued → running → succeeded | failed`. A run that reuses a snapshot is `succeeded` and linked to it.

### 4.11 API surface

All tenant data is served under `/api/workspaces/:workspaceId/...` from M2 onwards, so URLs do not change when real workspaces arrive.

- **M2–M3:** a single `local` workspace, read from snapshot and evaluation files.
- **M4:** the seeded default workspace, read from Postgres.
- **M5:** real workspaces, checked by `WorkspaceMemberGuard`.

| M  | Endpoints (relative to the workspace unless they start with `/auth` or `/github`) |
| -- | ------------------------------------------------------------------------------- |
| M2 | `GET /snapshots`, `GET /snapshots/:id`, `GET /snapshots/:id/graph?depth=&expand=&roles=&includeTypeOnly=&level=component\|file&componentId=`, `GET /snapshots/:id/components/:componentId`, `GET /snapshots/:id/dependencies/:dependencyId` |
| M3 | `GET /snapshots/:id/evaluations`, `GET /evaluations/:id`, `GET /evaluations/:id/findings?severity=&ruleId=&baseline=&status=&cursor=`, `GET /findings/:id`, `GET /evaluations/:id/health` |
| M4 | `GET/POST /repositories`, `GET /repositories/:id`, `POST /repositories/:id/analyses` (returns `202 { runId }`), `GET /analysis-runs/:id`, `GET /repositories/:id/snapshots` (paginated), `POST /snapshots/:id/evaluations` (re-evaluate) |
| M5 | `GET /auth/github/login`, `GET /auth/github/callback`, `POST /auth/logout`, `GET /me`, `GET/POST /workspaces`, `GET /members`, `PATCH/DELETE /members/:userId`, `GET/POST /invitations`, `DELETE /invitations/:id`, `POST /invitations/accept` (token in body), `POST /github/webhooks`, `GET/POST /github/installations`, `GET /github/installations/:id/repositories`, `DELETE /repositories/:id` |
| M6 | `GET/PUT /settings/ai`, `GET/POST /conversations`, `GET /conversations/:id`, `POST /conversations/:id/messages` (SSE progress, then the validated answer), `GET /agent-runs/:id` |
| M7 | `GET /snapshots/:baseId/compare/:headId`, `DELETE /workspaces/:id` |

Conventions:
- Errors use a consistent `{ error: { code, message, details? } }` shape.
- Collections use cursor pagination.
- Requests are validated with zod-based pipes.
- OpenAPI is generated from the zod contracts and served at `/api/docs`.

### 4.12 AI assistant

- **Access.** `ArchitectureQueryPort` is defined in `agent-runtime` and implemented by `apps/api` query services. Every run is bound server-side to `(workspaceId, snapshotId)`; the model never supplies these values.
- **Tools (read-only, no file contents):**

  | Tool                   | Purpose                                          |
  | ---------------------- | ------------------------------------------------ |
  | `get_snapshot_summary` | Overview of the snapshot                         |
  | `list_components`      | Components, optionally under a given parent      |
  | `get_component`        | Details of one component                         |
  | `get_dependencies`     | Dependencies, filterable by from, to and kind    |
  | `find_path`            | Path between two components                      |
  | `list_findings`        | Findings of the current evaluation               |
  | `get_finding`          | One finding with its evidence                    |
  | `search_symbols`       | Find symbols by name                             |
  | `get_file_imports`     | Imports of one file                              |

- **Answer contract.** The model returns `{ summary, claims: [{ text, citations: [{ type, id }] }], insufficientEvidence }`.
  - A validator checks every citation ID against this run's tool results.
  - If any claim fails, the agent gets one retry with feedback. Claims still without a valid citation are then removed. If nothing substantive remains, the answer becomes an insufficient-evidence response.
  - Removals are logged on the `AgentRun`.
- **Streaming.** Progress events (steps, tool calls) stream over SSE as they happen. The answer is delivered only after validation, so users never see a claim that is later withdrawn.
- **Data policy (ADR-0012).**
  - Only architecture-model data is sent to the provider: component and file paths, symbol names, import specifiers, metrics, findings, and the user's questions.
  - File contents are never sent in the MVP.
  - Providers are configured for no training on customer data and minimal retention, where offered.
  - AI is off until a workspace owner enables it on a settings screen that names the provider and lists the data sent.
  - Every `AgentRun` records its provider and model.
- **Guardrails.**
  - Limits on steps, tokens and time per run.
  - Repository content is treated as untrusted data, never as instructions.
  - The agent has no write tools.
  - Usage limits per workspace.
- **Quality bar (M6 exit).**
  - Unit and integration tests use a deterministic fake model. These test the plumbing only.
  - A live evaluation set of at least 30 questions over 3 snapshots (fixtures plus real repositories) is scored automatically:
    - Expected facts cited in at least 80% of answerable questions.
    - Correct insufficient-evidence responses on at least 90% of unanswerable questions.
    - Zero displayed citations that fail to resolve.
  - You manually review 20 answers.
  - The live evaluation is opt-in, never part of ordinary CI, and is rerun whenever the model or prompts change. Results are recorded in `docs/development/`.

### 4.13 Security model

> **Pending change (ADR-0009).** Clerk is the preferred authentication provider (email and password, plus Sign in with GitHub). If approved, Clerk replaces the custom OAuth, session and cookie handling below. The following stay our responsibility, and ADR-0009 must answer the open questions before M5.2 starts:
>
> - Verify the Clerk session token server-side in the API, and keep `WorkspaceMemberGuard` and `workspaceId` filtering in our own database.
> - Map Clerk users to our `User` and `Workspace` records, for example through Clerk webhooks. Decide whether Clerk Organizations are used or workspace membership stays in our database.
> - Sign-in only identifies the user. Per-user repository access checks (FR-I4) still need GitHub access that proves what the user can read. Decide between the GitHub token stored by Clerk and a separate GitHub App user authorisation.
> - Keep GitHub tokens out of the browser and encrypted at rest.
> - Keep CSRF and origin checks if cookies authenticate API calls.
> - Invitations are accepted by the invited GitHub login today. Decide how this works for email and password users.
> - Ordinary tests mock Clerk. Dev and staging use separate Clerk instances.

- **Authentication.** GitHub App user authorisation (OAuth) with a `state` parameter.
  - Sessions are stored server-side, with a hashed token in a `httpOnly`, `Secure`, `SameSite=Lax` cookie.
  - State-changing requests are protected by an origin check plus a CSRF token.
  - User-to-server tokens are encrypted at rest and never reach the browser.
- **Authorisation.**
  - A `WorkspaceMemberGuard` runs on every tenant route and checks membership on every request, so removing a member takes effect immediately.
  - Every query filters by `workspaceId`.
  - Only owners manage members, invitations, installations, repositories and AI settings.
- **Repository access.**
  - An installation is linked only after GitHub confirms that the user can access it.
  - Each repository is linked only if it appears in that user's accessible repositories.
  - The user's access is re-checked whenever they trigger an analysis.
  - Uninstall and repository-removal webhooks disconnect repositories (FR-I6).
  - Viewing data is governed by workspace membership (FR-I5).
- **GitHub permissions.** `contents: read` and `metadata: read` only. Installation tokens are short-lived and used only by the worker parent process. Webhook signatures are verified.
- **Untrusted source.** NFR-5 and NFR-6 apply, including the isolated analysis process and safe extraction. Malicious archive fixtures (path traversal, symlinks, archive bombs) are part of the tests.
- **Environments.** The staging environment (M5) uses its own GitHub App, database and secrets.
- **Review gate.** A mandatory human security review at the end of M5, before any external user is invited.

## 5. Milestones

Detailed tasks and acceptance criteria are in the [backlog](../BACKLOG.md). Each milestone summary below gives its goal, scope, exit criteria and ADRs.

### M1 — Local analysis CLI

- **Goal:** prove the analysis engine on real TypeScript repositories.
- **Scope:**
  - Monorepo, tooling and CI.
  - Domain model, snapshot and config schemas.
  - File discovery and roles.
  - Import extraction (with kinds) and symbol extraction.
  - Install-free module resolution with statistics.
  - Component hierarchy mapping.
  - Graph, metrics and cycles.
  - Reproducible snapshot builder.
  - CLI, fixtures and the resolution benchmark.
- **Exit criteria:**
  - Every fixture matches its expected graph.
  - On at least two open-source TypeScript monorepos, the unresolved rate is at most 2% and agreement with the reference tool is at least 95%.
  - The same repository copied to two different directories produces an identical `contentHash`.
  - Malformed files produce diagnostics instead of crashes.
  - Performance has been measured against NFR-7.
- **ADRs:** 0001, 0002, 0003, 0004, 0005.

### M2 — Local architecture explorer

- **Goal:** make snapshots explorable, and check that the inferred hierarchy makes sense to people.
- **Scope:**
  - Explorer contracts.
  - Read-only NestJS API over a snapshot directory.
  - Next.js explorer: hierarchical graph, expand and collapse, cycles, filters (roles, type-only), search, details, evidence and file-level drill-down.
- **Exit criteria:**
  - Running `pnpm dev` with `ARCHMIND_SNAPSHOT_DIR` set lets you browse any M1 snapshot.
  - ArchMind's own bounded contexts are visible as child components.
  - The graph stays usable at NFR-7 scale.

### M3 — Local governance

- **Goal:** answer "what should I be concerned about?" before any platform investment.
- **Scope:**
  - Rule model and config validation.
  - Governance engine with default rules.
  - Evaluation documents and baseline comparison.
  - `archmind check`.
  - Findings and health in the local explorer, with graph highlighting.
- **Exit criteria:**
  - Cycles, layer violations and threshold breaches appear as findings with file-level evidence.
  - Tests and type-only cycles do not produce default findings.
  - `archmind check` fails on a fixture with violations, and with `--baseline` reports only new ones.
  - Editing only rules reuses the snapshot.
  - ArchMind's own CI runs `archmind check` and passes.
- **ADRs:** 0006.

### M4 — Persistent analysis service

- **Goal:** turn the tool into a service with history, background processing and automatic baselines.
- **Scope:**
  - Docker Compose with Postgres.
  - Prisma schema, storage model and seeded default workspace.
  - pg-boss queue and worker with an isolated analysis process and reaper.
  - Idempotent, atomic snapshot persistence.
  - Persisted rule evaluations with automatic baselines.
  - Repository, run, snapshot and evaluation APIs and UI.
  - Structured logging with redaction.
- **Exit criteria:**
  - `docker compose up` starts the stack.
  - You can add a local repository, analyse it, and open its history.
  - Re-analysing unchanged source reuses the snapshot. An uncommitted edit creates a new one.
  - Killing the worker mid-run leaves no partial snapshot, and the reaper recovers the run.
  - A run that exceeds its memory or time limit fails cleanly while the worker stays healthy.
  - Findings show new, existing or resolved against the automatic baseline.
  - Logs contain no secrets or source.
- **ADRs:** 0007, 0008.

### M5 — GitHub, teams and staging

- **Goal:** real users and real repositories on a shared, hosted environment, safely.
- **Scope:**
  - GitHub App and sign-in with sessions.
  - Workspaces, membership, invitations and the guard.
  - Installation linking with per-user repository access checks.
  - Disconnection handling.
  - GitHub source provider with safe extraction.
  - Commit-pinned GitHub links.
  - Minimal staging environment.
  - Cross-tenant tests.
  - **Security review checkpoint.**
- **Exit criteria:**
  - On staging, an invited teammate signs in, accepts the invitation, and explores a private repository analysed from GitHub.
  - A user cannot link a repository they cannot access.
  - Cross-tenant tests pass.
  - Malicious archive fixtures are handled.
  - Uninstalling the App disconnects its repositories.
  - The security review is signed off.
- **ADRs:** 0009, 0010, 0011.

### M6 — AI architecture assistant

- **Goal:** natural-language exploration based on the architecture model and findings.
- **Scope:**
  - AI data policy and workspace opt-in.
  - Read-only tools behind `ArchitectureQueryPort`.
  - LangGraph.js agent with claim-level validated citations.
  - Conversations with progress streaming.
  - "Explain this finding".
  - Tracing and usage limits.
  - Evaluation harness and quality bar.
- **Exit criteria:**
  - AI is disabled by default, and enabling it shows the data policy.
  - The live evaluation meets the quality bar in §4.12.
  - Every displayed citation resolves to an explorer link.
  - Turning the model off, or forcing it to fail, leaves analysis and findings fully working.
- **ADRs:** 0012.

### M7 — Beta

- **Goal:** a production, observable and secure product for early teams.
- **Scope:**
  - Snapshot comparison.
  - Optional analysis on push.
  - Onboarding and starter config generation.
  - Production environment with backups and continuous deployment.
  - Metrics, error monitoring and alerting.
  - Playwright end-to-end journeys.
  - Rate limiting.
  - Data retention and workspace deletion.
  - Pilot with early teams.
- **Exit criteria:**
  - External teams onboard without help.
  - Errors and slow analyses trigger alerts.
  - Restoring from backup has been verified.
  - Pilot feedback is collected and post-beta priorities are agreed.

## 6. Testing strategy per milestone

| M  | Unit | Integration | E2E |
| -- | ---- | ----------- | --- |
| M1 | Extraction and import kinds, roles, resolution strategies, hierarchy mapping, projection, metrics, Tarjan, hashing | CLI against fixture repositories with expected graphs. Reproducibility across directories. Resolution benchmark (manual, dev-only). | — |
| M2 | Graph view-model mapping, projection filters | API against fixture snapshots | Smoke test: open the explorer, expand a component, view evidence |
| M3 | Every rule type, fingerprint stability, evaluation comparison, config validation errors | `archmind check` against violation fixtures, with and without a baseline | View a finding and jump to the graph |
| M4 | Run state machine, idempotency keys, baseline selection | Prisma repositories, worker pipeline, child-process timeout and memory kill, reaper (test Postgres in Docker) | Add repository, analyse, view findings and history |
| M5 | Guard, session and invitation logic | Cross-tenant access matrix, repository access checks, webhook signatures, malicious archive fixtures | Sign-in and invitation acceptance (GitHub mocked) |
| M6 | Citation validation, context binding, data-policy enforcement (fake model) | Agent with fake model and real query services | Enable AI, ask a question, click a citation |
| M7 | Snapshot diff | Push webhook to analysis | All core journeys (see the backlog) |

The [testing instructions](../../.github/instructions/testing.instructions.md) apply throughout:
- Tests are deterministic.
- External services are mocked.
- Ordinary tests never make real LLM calls.
- Failure scenarios are tested as well as successful runs.

## 7. Risks and mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Install-free resolution is wrong for real-world setups (`exports` maps, `dist` entry points, missing `extends` bases) | Use the explicit strategy in §4.6. Measure resolution rate and reference-tool agreement in M1. Fall back to component-level edges rather than failing. |
| The inferred hierarchy is not meaningful to users | Validate on real repositories in M2. Use `componentRoots` and configured components. Generate a starter config in M7. |
| False findings from tests and type-only imports erode trust | Use the production graph by default. Flag `typeOnly` cycles. Let rules opt in explicitly. |
| Large repositories are slow or use too much memory | Parse without type-checking, enforce limits, use an isolated process with a memory cap, and measure from M1. |
| Storage growth from frequent analyses | Keep only the relational core, store details as deduplicated compressed documents, and add retention policies in M7. |
| Graph becomes unreadable at scale | Show the hierarchy collapsed by default, filter, and collapse external dependencies. |
| Malicious repository content (archive tricks, prompt injection) | Apply NFR-5 and NFR-6, the isolated process, read-only AI tools and validated citations, and run the security review in M5. |
| Solo developer scope creep | Keep strict milestone exit criteria. Anything not needed for the current demo goes to the backlog. |

## 8. After beta

- Change impact analysis on pull requests: analyse the head commit, compare it with the base and comment on the PR.
- Ancestry-based baselines using the GitHub compare API.
- Change-frequency hotspots from Git history.
- Moving workflows to Temporal when they become long-running or multi-step.
- Moving snapshot documents to object storage.
- Architecture health trends over time.
- More languages via Tree-sitter.
- Rule editing in the UI, without commits.
- Billing and usage plans.

## 9. Approvals required before implementation

These items need human approval before work starts, because of the project's rules on boundaries, dependencies, auth and infrastructure. Each one is documented as an ADR in `docs/adr/`.

| # | Decision | ADR | Needed by |
| - | -------- | --- | --------- |
| 1 | Modular monolith and package layout | ADR-0001 | M1 |
| 2 | Analysis-first delivery and the new `apps/cli` | ADR-0002 | M1 |
| 3 | zod for schemas and validation, with a NestJS integration and OpenAPI generator (replacing class-validator) | ADR-0003 | M1 |
| 4 | Snapshot format, identity and hashing | ADR-0004 | M1 |
| 5 | Hierarchical component model and file roles | ADR-0005 | M1 |
| 6 | Governance rules and rule evaluations | ADR-0006 | M3 |
| 7 | pg-boss instead of Temporal for the MVP, and isolated analysis execution | ADR-0007 | M4 |
| 8 | Snapshot storage model | ADR-0008 | M4 |
| 9 | GitHub App permissions, authentication (Clerk preferred) and sessions | ADR-0009 | M5 |
| 10 | Tenant isolation, sharing and repository access model | ADR-0010 | M5 |
| 11 | Hosting provider and staging environment (Neon under consideration) | ADR-0011 | M5 |
| 12 | First LLM provider and AI data policy | ADR-0012 | M6 |

Small libraries are confirmed in the task that introduces them:
- CLI argument parsing.
- Ignore-file and glob matching.
- YAML parsing (`pnpm-workspace.yaml`).
- Tar extraction.
- Graph layout (elkjs or dagre).
- Logging (pino).
- The dev-only reference tool for the resolution benchmark.

## 10. Documentation alignment

- [ARCHITECTURE.md](../ARCHITECTURE.md) shows `apps/cli`, the governance engine as the owner of rule evaluation, and zod and pg-boss as *proposed*. Each is marked as pending its ADR.
- Once an ADR is accepted, update `ARCHITECTURE.md` and remove the "proposed" marker.

## 11. Revision history

- **Revision 2 (2026-11-15):** changes made in response to a review of revision 1.
  - **Snapshots:** `contentHash` is now reproducible across checkouts. Components are hierarchical. Module resolution has an explicit install-free strategy with a measurable bar. File roles and import kinds are classified.
  - **Sequencing:** governance moved to M3, before the platform. Minimal staging and structured logging moved earlier, to M5 and M4.
  - **Governance and runs:** rule evaluations are separated from snapshots. Baselines are defined. Local idempotency uses a source hash.
  - **Teams and access:** invitations added. Repository access is checked per user. Revocation behaviour is defined.
  - **Execution and archives:** analysis runs in an isolated child process with a reaper for stuck runs. Archive limits are complete.
  - **AI:** answers are shown only after citation validation. M6 has a quality bar. An AI data policy and opt-in were added.
  - **Storage and docs:** storage uses a relational core plus deduplicated documents. zod is listed for approval. Module ports and config ownership are explicit. "Hotspots" now means coupling, with churn deferred.
- **Revision 1 (2026-11-15):** initial plan.
