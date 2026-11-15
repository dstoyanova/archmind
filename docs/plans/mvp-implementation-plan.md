# ArchMind — MVP Implementation Plan

**Status:** Draft
**Last updated:** 2026-11-15

This plan turns the [product overview](../PRODUCT.md) and [technical architecture](../ARCHITECTURE.md) into concrete requirements, a target architecture and an incremental delivery sequence.

- The milestone overview lives in the [roadmap](../ROADMAP.md).
- Task-level breakdown with acceptance criteria lives in the [backlog](../BACKLOG.md).

## 1. Delivery strategy

ArchMind is built **analysis-first**. The deterministic analysis engine is both the core product value and the biggest technical risk, so it is built and validated first. Platform concerns are added in later milestones: persistence, authentication, GitHub, governance and AI.

Every milestone ends with a **working, demoable product**. No milestone consists only of infrastructure.

| Milestone | Name                        | Working product at the end                                                 |
| --------- | --------------------------- | -------------------------------------------------------------------------- |
| M1        | Local analysis CLI          | `archmind analyze ./repo` produces an architecture snapshot and summary.   |
| M2        | Local architecture explorer | Browse any analysed repository as an interactive graph in the browser.     |
| M3        | Persistent analysis service | Add a repository, analyse it in the background and see analysis history.   |
| M4        | GitHub and multi-user       | Sign in with GitHub, connect a repository and explore it with teammates.   |
| M5        | Governance and findings     | See architectural risks and rule violations, with evidence.                |
| M6        | AI architecture assistant   | Ask questions about the architecture and get answers that cite evidence.   |
| M7        | Beta                        | A hosted, monitored product with history and comparison, ready for pilots. |

## 2. Key decisions

| Decision           | Choice                                                                                       | Rationale                                                                                 | ADR      |
| ------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| Architecture style | Modular monolith in a pnpm + Turborepo monorepo                                              | Clear boundaries without distributed-system overhead.                                     | ADR-0001 |
| Delivery order     | Analysis-first; governance before AI                                                         | De-risks the core engine early. Lets the AI build on deterministic facts and findings.    | ADR-0002 |
| CLI application    | New `apps/cli`                                                                               | Fastest feedback loop. Later reused for local checks and CI.                              | ADR-0002 |
| Snapshot format    | Versioned, immutable JSON snapshot defined in `packages/contracts`                           | One shape is shared by the CLI, API, database and tests.                                  | ADR-0003 |
| Component model    | Hybrid: inferred from workspace packages and folders, overridable via `archmind.config.json` | Useful with zero configuration; precise when configured.                                  | ADR-0004 |
| Background jobs    | Postgres-backed queue (pg-boss) behind a `JobQueue` interface; Temporal later                | No extra infrastructure for a solo developer. Swappable without changing workflow code.   | ADR-0005 |
| Authentication     | Sign in with GitHub (GitHub App user authorisation) and server-side sessions                 | Target users already use GitHub. No password handling.                                    | ADR-0006 |
| Tenant isolation   | Every tenant-owned row has a workspace ownership path, enforced by a server-side guard       | Required for multi-tenancy. Modelled from M3 so it never has to be retrofitted.           | ADR-0007 |
| Governance rules   | Declarative rules in `archmind.config.json`, evaluated by a pure engine                      | Reviewable in Git, deterministic, usable in CI.                                           | ADR-0008 |
| LLM provider       | Provider-agnostic via the LangChain chat model interface; start with one provider            | Avoids lock-in. LangGraph.js already depends on this interface.                           | ADR-0009 |
| Deployment         | Docker Compose locally; cloud host chosen at beta                                            | Defers the cost and decision until real usage exists.                                     | ADR-0010 |

Decisions that change architectural boundaries, add major dependencies or touch auth/tenancy require human approval before implementation (see §9).

## 3. Product requirements

### 3.1 Users and core jobs

| User                        | Core job in the MVP                                                            |
| --------------------------- | ------------------------------------------------------------------------------ |
| Software architect          | Understand the actual structure and dependencies, and check intended layering. |
| Principal or staff engineer | Find cycles, hotspots and boundary violations before they spread.              |
| Engineering manager or head | Get an evidence-backed view of architectural health and risk.                  |

The MVP must answer: **"What does my software architecture look like, and what should I be concerned about?"**

### 3.2 Functional requirements

The **M** column gives the milestone in which each requirement is delivered.

#### Analysis (FR-A)

| ID    | Requirement | M |
| ----- | ----------- | - |
| FR-A1 | Discover TypeScript/JavaScript source files (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`). Respect `.gitignore`. Exclude `node_modules`, build output, `.d.ts` and generated files. | M1 |
| FR-A2 | Extract imports: static imports, `export … from`, `import type`, `require()` with a literal argument, and `import()` with a literal argument. | M1 |
| FR-A3 | Extract exported symbol declarations (functions, classes, interfaces, types, enums, variables) with source locations. | M1 |
| FR-A4 | Resolve each import. Support `tsconfig` `baseUrl`/`paths`, project references and pnpm/npm/yarn workspaces. Classify each import as internal file, workspace package, external package, Node built-in or unresolved. | M1 |
| FR-A5 | Group files into components using the hybrid model (§4.5). | M1 |
| FR-A6 | Build a component dependency graph. Every dependency stores its evidence: source file, line and import specifier. | M1 |
| FR-A7 | Compute metrics per component: file count, lines of code, fan-in, fan-out and instability. Detect dependency cycles at both component and file level. | M1 |
| FR-A8 | Produce an immutable, versioned snapshot (§4.4). Malformed or unsupported files produce diagnostics and never abort the analysis. | M1 |
| FR-A9 | Analyse a repository from a local path (M1–M3) or from GitHub at a specific commit (M4). | M1, M4 |

#### Explorer (FR-E)

| ID    | Requirement | M |
| ----- | ----------- | - |
| FR-E1 | Show the component graph with automatic layout, zoom, pan and search. | M2 |
| FR-E2 | Highlight cycles. Filter by component and by dependency kind (internal or external). | M2 |
| FR-E3 | Show component details: metrics, files, inbound and outbound dependencies. | M2 |
| FR-E4 | Show dependency evidence as the list of importing file locations. | M2 |
| FR-E5 | Drill down from a component to its file-level graph. | M2 |
| FR-E6 | Link evidence to the exact line on GitHub, pinned to the analysed commit. | M5 |

#### Repositories and analysis runs (FR-R)

| ID    | Requirement | M |
| ----- | ----------- | - |
| FR-R1 | Register repositories. In M3 this is a local path, enabled only in development mode. From M4 repositories come from a GitHub installation. | M3, M4 |
| FR-R2 | Trigger an analysis that runs in the background, and show its status (queued, running, succeeded, failed) and its diagnostics. | M3 |
| FR-R3 | List snapshot history per repository and open any past snapshot. | M3 |
| FR-R4 | Re-analysing the same commit, config and engine version reuses the existing snapshot. | M3 |
| FR-R5 | Compare two snapshots: added or removed components and dependencies, metric changes, new or resolved findings. | M7 |
| FR-R6 | Optionally analyse automatically on push to the default branch. | M7 |

#### Identity and workspaces (FR-I)

| ID    | Requirement | M |
| ----- | ----------- | - |
| FR-I1 | Sign in and sign out with GitHub. | M4 |
| FR-I2 | Create a personal workspace automatically on first sign-in. Users can belong to several workspaces, with the role owner or member. | M4 |
| FR-I3 | Workspace owners can link a GitHub App installation and choose which repositories to analyse. | M4 |
| FR-I4 | Every workspace-owned resource is accessible only to members of that workspace. | M4 |

#### Governance (FR-G)

| ID    | Requirement | M |
| ----- | ----------- | - |
| FR-G1 | Declare rules in `archmind.config.json`: layer ordering, forbidden dependencies, no cycles, metric thresholds and restricted external packages. | M5 |
| FR-G2 | Run built-in default rules when no config exists: no component cycles and high-coupling warnings. | M5 |
| FR-G3 | Each finding records its rule ID and version, severity, message, evidence, and a stable fingerprint that tracks it across snapshots. | M5 |
| FR-G4 | Mark each finding as new, existing or resolved compared with the previous snapshot of the same repository. | M5 |
| FR-G5 | Show findings in a list and highlight them on the graph. Show a health summary per repository. | M5 |
| FR-G6 | `archmind check` evaluates rules locally and exits non-zero when violations exceed a severity threshold. | M5 |

#### AI assistant (FR-AI)

| ID     | Requirement | M |
| ------ | ----------- | - |
| FR-AI1 | Ask natural-language questions about a selected snapshot in a chat panel. Responses stream as they are generated. | M6 |
| FR-AI2 | Answers cite components, dependencies, files or findings. Each citation is a clickable link into the explorer. | M6 |
| FR-AI3 | When the evidence is insufficient, the assistant says so rather than guessing. | M6 |
| FR-AI4 | Each finding has an "Explain this finding" action. | M6 |
| FR-AI5 | Conversations are saved per workspace and snapshot. | M6 |

### 3.3 Non-functional requirements

| ID     | Area             | Requirement |
| ------ | ---------------- | ----------- |
| NFR-1  | Determinism      | The same source, config and engine version produce a byte-identical snapshot `contentHash`. Timestamps are excluded from the hash. All collections are sorted and IDs are derived deterministically. |
| NFR-2  | Versioning       | Every snapshot records `schemaVersion`, `engineVersion`, `parserVersion` (the TypeScript version) and `configHash`. |
| NFR-3  | Immutability     | Published snapshots and their child rows are never updated. Re-analysis creates a new snapshot. |
| NFR-4  | Idempotency      | Analysis jobs are safe to retry. The idempotency key is `repositoryId + commitSha + engineVersion + configHash`. |
| NFR-5  | Untrusted input  | Source code is never executed: no package installs, no build scripts, no JavaScript config files. Archive extraction rejects path traversal and symlinks and enforces size limits. |
| NFR-6  | Resource limits  | Provisional limits, configurable and validated in M1: 1 MB maximum per parsed file, 20,000 files maximum, 500 MB maximum archive size, 10-minute analysis timeout. Exceeding a limit produces a diagnostic, not a crash. |
| NFR-7  | Performance      | Provisional target, to be measured in M1: analyse a 5,000-file repository in under 2 minutes on a developer laptop. The explorer stays responsive with 300 components and 3,000 dependencies. |
| NFR-8  | Tenant isolation | All tenant-owned data is reachable only through a workspace. Every route that touches it is checked server-side. Cross-tenant access is covered by automated tests. |
| NFR-9  | Secrets          | GitHub tokens and the App private key stay server-side and come from environment variables or a secret manager. They are never logged and never sent to the browser. |
| NFR-10 | AI isolation     | AI processing is separate from deterministic analysis. An AI failure never affects snapshots or findings. AI tools are read-only. |
| NFR-11 | Observability    | Logs are structured and carry request and analysis-run correlation IDs. Source code and secrets are never logged. |
| NFR-12 | Accessibility    | Core flows are keyboard-navigable and the graph has an accessible list alternative. |

## 4. Technical architecture

### 4.1 Deployable units and packages

| Unit                           | Responsibility | Introduced |
| ------------------------------ | -------------- | ---------- |
| `apps/cli`                     | `archmind analyze` and `archmind check`. Composes the analysis packages. | M1 |
| `apps/api`                     | NestJS REST API with OpenAPI. Owns authentication, workspaces, repositories, runs, explorer queries, findings and conversations. | M2 |
| `apps/web`                     | Next.js, React, Tailwind and React Flow. Feature folders: explorer, repositories, findings, assistant, settings. | M2 |
| `apps/worker`                  | Consumes jobs: analyse repository, evaluate rules and (later) refresh on push. | M3 |
| `packages/config`              | Shared `tsconfig`, ESLint, Prettier and Vitest configuration. | M1 |
| `packages/domain`              | Pure domain types and invariants: snapshot, component, dependency, evidence, finding, rule. No I/O. | M1 |
| `packages/contracts`           | zod schemas for the snapshot format and API request/response models. OpenAPI is generated from them. | M1 |
| `packages/code-analysis`       | Source providers, file discovery, TypeScript parsing, import and symbol extraction, module resolution. | M1 |
| `packages/architecture-engine` | Component mapping, graph aggregation, metrics, cycle detection, snapshot building and hashing. | M1 |
| `packages/database`            | Prisma schema, migrations and repository implementations. | M3 |
| `packages/governance-engine`   | Rule model, config validation, pure rule evaluation and finding fingerprints. | M5 |
| `packages/agent-runtime`       | LangGraph.js assistant, tool definitions, model provider adapter and citation validation. | M6 |
| `packages/observability`       | Logger, correlation IDs, metrics and error reporting. | M7 (introduce earlier if needed) |

### 4.2 Dependency rules between modules

```text
apps/*  ──►  packages/* (via public entry points only)

code-analysis ───────┐
architecture-engine ─┤
governance-engine ───┼──►  domain   (domain depends on no internal package)
agent-runtime ───────┤
database ────────────┘

contracts ──► domain
agent-runtime ──► contracts (tool input/output schemas)
```

- No package depends on an app, and packages never import each other's internals.
- The engines (code-analysis, architecture-engine, governance-engine) do no network or database I/O. They receive data through ports such as `SourceProvider`.
- Apps compose the packages. Application services in `apps/api` and `apps/worker` coordinate use cases.
- These rules are enforced with ESLint import restrictions from M1. From M5, ArchMind checks its own repository with `archmind check`.

### 4.3 Analysis pipeline

```text
SourceProvider (LocalFs | GitHubTarball)
  → discover files (ignore rules, size/count limits)
  → detect project config (tsconfig(s), workspace manifests, archmind.config.json)
  → parse each file (ts.createSourceFile, no type-checking)
  → extract imports + exported symbols (with line/column)
  → resolve imports (ts.resolveModuleName + workspace map) → file graph
  → map files → components (hybrid model)
  → aggregate component graph with evidence
  → compute metrics + strongly connected components (Tarjan)
  → build snapshot (sorted, hashed, versioned)
  → [M3+] persist atomically  → [M5+] evaluate rules → findings
```

Each stage is a pure function over the previous stage's output, apart from `SourceProvider`, so stages can be tested in isolation.

### 4.4 Snapshot model

```text
ArchitectureSnapshot
  schemaVersion, engineVersion, parserVersion, configHash, contentHash
  repository: { name, rootPath | githubFullName }, commitSha?, createdAt
  components[]:   { id, name, kind (package|folder|configured), paths[], metrics }
  files[]:        { id, path, componentId, language, loc, parseStatus }
  symbols[]:      { id, fileId, name, kind, exported, line, column }
  fileImports[]:  { id, fromFileId, specifier, kind, resolution, toFileId?, externalPackage?, line, column }
  dependencies[]: { id, fromComponentId, toComponentId, weight, evidenceImportIds[] }
  externalDependencies[]: { componentId, packageName, weight }
  cycles[]:       { level (component|file), memberIds[] }
  diagnostics[]:  { severity, code, message, filePath?, line? }
```

- IDs are deterministic. For example, a component ID is a hash of its name and a file ID is a hash of its path.
- `contentHash` covers everything except `createdAt`.
- A dependency always references two components in the same snapshot. The builder validates this invariant.

### 4.5 Component inference (hybrid model)

Rules apply in priority order. A file belongs to exactly one component.

1. **Configured:** entries in `archmind.config.json` under `components` map a name to path globs. The first matching entry wins.
2. **Workspace packages:** each package found from `pnpm-workspace.yaml` or the `workspaces` field in `package.json` becomes one component.
3. **Folders:** in a single-package repository, each first-level directory under the source root (`src/`, or the `tsconfig` `rootDir`) becomes a component. Files directly in the root go to a `<root>` component.

`archmind.config.json` is JSON only, validated against a zod schema and never executed. Its `rules` section is added in M5.

### 4.6 Persistence model

PostgreSQL via Prisma, introduced in M3. Every tenant-owned table is reachable from `Workspace`.

| Entity | Ownership path | Notes | M |
| ------ | -------------- | ----- | - |
| `Workspace` | root | M3 seeds one default workspace. M4 adds real workspaces. | M3 |
| `Repository` | Workspace | `sourceType` is local or github. A GitHub repository has a unique `githubRepoId` per workspace. | M3 |
| `AnalysisRun` | Repository | Status, idempotency key, timings, error and diagnostics count. | M3 |
| `ArchitectureSnapshot` | Repository (and AnalysisRun) | Version fields, `commitSha`, `contentHash`. Immutable. | M3 |
| `Component`, `Dependency`, `DependencyEvidence`, `SourceFile`, `FileImport`, `Symbol`, `Cycle`, `Diagnostic` | Snapshot | Bulk-inserted. Immutable. Indexed on `(snapshotId, …)`. | M3 |
| `User`, `Session`, `WorkspaceMember` | — / User / Workspace | `Session` stores a hashed token and an expiry. | M4 |
| `GitHubInstallation` | Workspace | The installation ID is verified against the user's accessible installations. | M4 |
| `Finding` | Snapshot | Rule ID and version, severity, fingerprint, status, evidence (JSON). | M5 |
| `Conversation`, `Message` | Workspace (and Snapshot) | | M6 |
| `AgentRun`, `ToolCall` | Conversation | Model, tokens, cost, latency, inputs and outputs. | M6 |

Prisma models stay inside `packages/database`. Repositories map them to domain types.

### 4.7 API surface

All tenant data is served under `/api/workspaces/:workspaceId/...` from M2 onwards, so URLs do not change when real workspaces arrive.

- **M2:** a single `local` workspace, read from snapshot files.
- **M3:** the seeded default workspace, read from Postgres.
- **M4:** real workspaces, checked by `WorkspaceMemberGuard`.

| M  | Endpoints |
| -- | --------- |
| M2 | `GET /snapshots`, `GET /snapshots/:id`, `GET /snapshots/:id/graph?level=component\|file&componentId=`, `GET /snapshots/:id/components/:componentId`, `GET /snapshots/:id/dependencies/:dependencyId` |
| M3 | `GET/POST /repositories`, `GET /repositories/:id`, `POST /repositories/:id/analyses` (returns `202 { runId }`), `GET /analysis-runs/:id`, `GET /repositories/:id/snapshots` (paginated) |
| M4 | `GET /auth/github/login`, `GET /auth/github/callback`, `POST /auth/logout`, `GET /me`, `GET/POST /workspaces`, `GET /workspaces/:id/members`, `POST /github/webhooks`, `GET/POST /github/installations`, `GET /github/installations/:id/repositories` |
| M5 | `GET /snapshots/:id/findings?severity=&ruleId=&status=&cursor=`, `GET /findings/:id`, `GET /snapshots/:id/health` |
| M6 | `GET/POST /conversations`, `GET /conversations/:id`, `POST /conversations/:id/messages` (SSE stream), `GET /agent-runs/:id` |
| M7 | `GET /snapshots/:baseId/compare/:headId` |

Conventions:
- Errors use a consistent `{ error: { code, message, details? } }` shape.
- Collections use cursor pagination.
- Request bodies and queries are validated with zod-based pipes.
- OpenAPI is served at `/api/docs`.

### 4.8 Background processing

- Application code depends only on a `JobQueue` port with `enqueue(type, payload, { idempotencyKey })` and handler registration. The M3 implementation is pg-boss, using the same Postgres instance. A Temporal adapter can replace it later.
- Jobs:
  - `analyse-repository { repositoryId, ref }` resolves the commit, checks the idempotency key, analyses the source and publishes the snapshot.
  - `evaluate-rules { snapshotId }` (from M5) runs as a separate job, so a rule failure never invalidates the snapshot.
- Policy: bounded retries with exponential backoff, a per-job timeout and limited worker concurrency. Temporary directories are always cleaned up.
- Run status transitions: `queued → running → succeeded | failed`. A run that finds an existing snapshot is marked `succeeded` and linked to that snapshot.

### 4.9 AI assistant

- **Context binding:** every agent run is bound to `(workspaceId, snapshotId)`. Tools receive this context from the server, never from the model.
- **Tools (read-only)** call the same application query services as the API:

  | Tool                   | Purpose                             |
  | ---------------------- | ----------------------------------- |
  | `get_snapshot_summary` | Overview of the snapshot            |
  | `list_components`      | All components                      |
  | `get_component`        | Details of one component            |
  | `get_dependencies`     | Dependencies, filterable by from/to |
  | `find_path`            | Path between two components         |
  | `list_findings`        | Findings for the snapshot           |
  | `get_finding`          | One finding with its evidence       |
  | `search_symbols`       | Find symbols by name                |
  | `get_file_imports`     | Imports of one file                 |

- **Answer contract:** the model returns a structured answer: `{ answer, citations: [{ type: component|dependency|file|finding, id }], insufficientEvidence }`. Every citation ID must appear in this run's tool results. Unverified citations are removed and logged.
- **Guardrails:**
  - Run limits: a maximum number of steps, maximum tokens and a timeout.
  - Repository content (names, comments, paths) is treated as untrusted data, never as instructions.
  - The agent has no write tools.
  - Usage limits apply per workspace.
- **Provider:** the provider and model are configured via environment variables and accessed through the LangChain chat model interface. The first provider is chosen when M6 starts.
- **Testing:**
  - Ordinary tests use a deterministic fake model.
  - A golden question set runs against fixture snapshots.
  - Live evaluations are opt-in and never part of ordinary CI.

### 4.10 Security model

- **Authentication:** GitHub App user authorisation (OAuth) with a `state` parameter. Sessions are stored server-side, with a hashed token in a `httpOnly`, `Secure`, `SameSite=Lax` cookie. State-changing requests are protected against CSRF with an origin check plus a CSRF token.
- **Authorisation:** a `WorkspaceMemberGuard` on every tenant route. Repository lookups always filter by `workspaceId`. Before an installation is linked, the API confirms through GitHub that the user can access it.
- **GitHub permissions:** `contents: read` and `metadata: read` only. Installation tokens are short-lived and used only by the worker. Webhook signatures are verified.
- **Untrusted source:** follow NFR-5 and NFR-6. Analysis runs in the worker process, which has no access to user sessions.
- **Review gate:** a mandatory human security review at the end of M4, before any external user is invited.

## 5. Milestones

Detailed tasks and acceptance criteria are in the [backlog](../BACKLOG.md). Each milestone summary below gives its goal, scope, exit criteria and ADRs.

### M1 — Local analysis CLI

- **Goal:** prove the analysis engine on real TypeScript repositories.
- **Scope:**
  - Monorepo, tooling and CI.
  - Domain and snapshot schema.
  - File discovery.
  - Import and symbol extraction.
  - Module resolution.
  - Component mapping.
  - Metrics and cycles.
  - Deterministic snapshot builder.
  - CLI.
  - Fixture repositories.
- **Exit criteria:**
  - `archmind analyze <path> --out snapshot.json` works on every fixture and on at least two real open-source TypeScript monorepos.
  - Running it twice produces an identical `contentHash`.
  - Malformed files produce diagnostics instead of crashes.
  - Performance against NFR-7 has been measured.
- **ADRs:** 0001, 0002, 0003, 0004.

### M2 — Local architecture explorer

- **Goal:** make snapshots explorable and validate that the inferred components are meaningful.
- **Scope:**
  - Explorer contracts.
  - Read-only NestJS API over a snapshot directory, behind a `SnapshotReader` port.
  - Next.js explorer: graph, cycles, search, details, evidence and file-level drill-down.
- **Exit criteria:**
  - Running `pnpm dev` with `ARCHMIND_SNAPSHOT_DIR` set lets you browse any snapshot produced in M1.
  - The graph stays usable at NFR-7 scale.

### M3 — Persistent analysis service

- **Goal:** turn the tool into a service with history and background processing.
- **Scope:**
  - Docker Compose with Postgres.
  - Prisma schema with a seeded default workspace.
  - pg-boss `JobQueue` and `apps/worker`.
  - Atomic, immutable snapshot persistence.
  - Repository, run and snapshot APIs.
  - Repository and run UI.
  - Explorer switched to the Postgres-backed reader.
- **Exit criteria:**
  - `docker compose up` starts the stack. You can add a local repository, trigger analysis, watch its status and open past snapshots.
  - Retrying the same commit reuses the existing snapshot.
  - Killing the worker mid-run leaves no partial snapshot.
- **ADRs:** 0005.

### M4 — GitHub and multi-user

- **Goal:** real users and real repositories, safely.
- **Scope:**
  - GitHub App.
  - GitHub sign-in and sessions.
  - Workspaces, membership and the guard.
  - Installation linking and repository selection.
  - GitHub tarball source provider with safe extraction.
  - Uninstall handling.
  - Cross-tenant tests.
  - **Security review checkpoint.**
- **Exit criteria:**
  - A second user signs in, connects a private repository, analyses it and explores it.
  - That user cannot access another workspace's data; automated tests prove this.
  - The security review is signed off.
- **ADRs:** 0006, 0007.

### M5 — Governance and findings

- **Goal:** answer "what should I be concerned about?"
- **Scope:**
  - Rule model and config validation.
  - Governance engine with default rules.
  - `evaluate-rules` job and the `Finding` table.
  - New/existing/resolved status tracking.
  - Findings API.
  - Findings UI with graph highlighting and GitHub permalinks.
  - Health summary.
  - `archmind check` CLI command.
- **Exit criteria:**
  - Cycles, layer violations and threshold breaches appear as findings with file-level evidence.
  - `archmind check` fails CI on a fixture that contains violations.
  - ArchMind analyses its own repository without violations.
- **ADRs:** 0008.

### M6 — AI architecture assistant

- **Goal:** natural-language exploration grounded in the model and findings.
- **Scope:**
  - Read-only tools.
  - LangGraph.js agent with validated citations.
  - Conversations API with SSE streaming.
  - Chat panel with clickable citations.
  - "Explain this finding".
  - Agent run and tool call tracing.
  - Usage limits.
  - Evaluation harness.
- **Exit criteria:**
  - The golden question set passes against fixture snapshots.
  - Every citation in an answer resolves to an explorer link.
  - Turning the model off (or forcing it to fail) leaves analysis and findings fully working.
- **ADRs:** 0009.

### M7 — Beta

- **Goal:** a hosted, observable and secure product for early teams.
- **Scope:**
  - Snapshot history and comparison.
  - Optional automatic analysis on push.
  - Onboarding flow.
  - Starter config generation.
  - Observability package.
  - Dockerfiles, CD and the hosted environment (staging and production).
  - Playwright end-to-end journeys.
  - Rate limiting.
  - Data retention and workspace deletion.
  - Pilot with early teams.
- **Exit criteria:**
  - External teams onboard without help.
  - Errors and slow analyses are visible in monitoring.
  - Backups are verified.
  - Pilot feedback is collected and post-beta priorities are agreed.
- **ADRs:** 0010.

## 6. Testing strategy per milestone

| M  | Unit | Integration | E2E |
| -- | ---- | ----------- | --- |
| M1 | Extraction, resolution, mapping, metrics, Tarjan, hashing | CLI against fixture repositories (`tests/fixtures`), plus a determinism test | — |
| M2 | Graph view-model mapping | API against fixture snapshots | Smoke test: open the explorer, select a component |
| M3 | Run state machine, idempotency key | Prisma repositories and the worker pipeline against a test Postgres (Docker) | Add repository, analyse, view the result |
| M4 | Guard logic, session handling | Cross-tenant access matrix, webhook signature verification, safe extraction | Sign-in (GitHub mocked) |
| M5 | Every rule type, fingerprint stability, config validation errors | `evaluate-rules` job, findings API | View a finding and jump to the graph |
| M6 | Citation validation, tool context binding (fake model) | Agent with fake model and real query services | Ask a question, click a citation |
| M7 | Snapshot diff | Push webhook to analysis | All core journeys (see the backlog) |

The [testing instructions](../../.github/instructions/testing.instructions.md) apply throughout:
- Tests are deterministic.
- External services are mocked.
- Ordinary tests never make real LLM calls.
- Failure scenarios are tested as well as successful runs.

## 7. Risks and mitigations

| Risk | Mitigation |
| ---- | ---------- |
| Module resolution is wrong for real-world setups (path aliases, project references, `exports` maps) | Validate on real open-source monorepos in M1. Report unresolved imports as diagnostics instead of hiding them. |
| Inferred components are not meaningful to users | Use M2 to validate on real repositories. Make the config override easy. Generate a starter config in M7. |
| Large repositories are slow or use too much memory | Parse without type-checking, stream files, enforce limits, insert in batches, measure from M1. |
| Graph becomes unreadable at scale | Show the component level by default, drill down to files, filter, collapse external dependencies. |
| Malicious repository content (archive tricks, prompt injection) | Follow NFR-5 and NFR-6, keep AI tools read-only, validate citations, review security in M4. |
| Solo developer scope creep | Keep strict milestone exit criteria. Anything not needed for the current milestone's demo goes to the backlog. |

## 8. After beta

- Change impact analysis on pull requests: analyse the head commit, diff it against the base and comment on the PR.
- Move workflows to Temporal when they become long-running or multi-step.
- Architecture health trends over time.
- More languages via Tree-sitter.
- Rule editing in the UI.
- Billing and usage plans.

## 9. Approvals required before implementation

These items need human approval before work starts, because of the project's rules on boundaries, dependencies, auth and infrastructure. Each one will be documented as an ADR in `docs/adr/`.

1. Adding `apps/cli` to the intended repository structure (ADR-0002).
2. Using pg-boss instead of Temporal for the MVP (ADR-0005).
3. GitHub App permissions and the authentication/session design (ADR-0006).
4. The tenant isolation model (ADR-0007).
5. The first LLM provider (ADR-0009).
6. The cloud hosting provider (ADR-0010).
7. Small new libraries, each confirmed in its task: CLI argument parsing, ignore-file matching, graph layout (elkjs or dagre) and logging (pino).
