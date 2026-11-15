# ArchMind — Backlog

Implementation tasks grouped by [roadmap](ROADMAP.md) milestone. Requirement IDs (FR-*, NFR-*) refer to the [MVP implementation plan](plans/mvp-implementation-plan.md).

Each task is sized to be completed and reviewed on its own, and can be split into smaller issues when work starts. A task is done when its acceptance criteria are met, and type checking, linting and the relevant tests pass.

Tasks marked **⚠ Approval** need human approval, normally recorded as an ADR, before implementation starts.

## M1 — Local analysis CLI

### M1.1 Bootstrap the monorepo ⚠ Approval (ADR-0001, ADR-0002)

Set up the pnpm workspace, Turborepo, and `packages/config` with shared strict `tsconfig`, ESLint, Prettier and Vitest. Add GitHub Actions CI.

- **Depends on:** —
- **Acceptance criteria:**
  - [ ] `pnpm install`, `pnpm lint`, `pnpm typecheck` and `pnpm test` work from the root via Turborepo.
  - [ ] CI runs lint, typecheck and test on every pull request.
  - [ ] ESLint import restrictions enforce the package dependency rules.
  - [ ] ADR-0001 (modular monolith) and ADR-0002 (analysis-first, `apps/cli`) are written in `docs/adr/`.

### M1.2 Define the domain and snapshot model (ADR-0003)

Create `packages/domain` with the snapshot types (SourceFile, FileImport, Symbol, Component, Dependency, Evidence, Cycle, Diagnostic). Create `packages/contracts` with the zod snapshot schema, including `schemaVersion`.

- **Depends on:** M1.1
- **Acceptance criteria:**
  - [ ] Domain types have no infrastructure dependencies.
  - [ ] The snapshot schema validates the version fields (NFR-2) and rejects dependencies that reference unknown components.
  - [ ] ADR-0003 (snapshot format) is written.

### M1.3 Discover source files

Add a `SourceProvider` port and a `LocalFsSourceProvider` in `packages/code-analysis`, plus file discovery (FR-A1).

- **Depends on:** M1.1
- **Acceptance criteria:**
  - [ ] Respects `.gitignore`.
  - [ ] Excludes `node_modules`, build output, `.d.ts` and generated files.
  - [ ] Enforces the file size and file count limits (NFR-6). Skipped files produce diagnostics.
  - [ ] Output is sorted deterministically.

### M1.4 Extract imports and symbols

Parse files with `ts.createSourceFile` (no type-checking). Extract imports (FR-A2) and exported symbols (FR-A3) with their line and column.

- **Depends on:** M1.3
- **Acceptance criteria:**
  - [ ] Covers static imports, `export … from`, `import type`, literal `require()` and literal `import()`.
  - [ ] Covers exported functions, classes, interfaces, types, enums and variables.
  - [ ] Malformed files produce a diagnostic and analysis continues.
  - [ ] Unit tests cover each import and symbol kind.

### M1.5 Resolve module dependencies

Detect tsconfig files and workspace manifests. Resolve each specifier with `ts.resolveModuleName` plus a workspace package map (FR-A4).

- **Depends on:** M1.4
- **Acceptance criteria:**
  - [ ] Supports `baseUrl`/`paths`, project references, and pnpm/npm/yarn workspaces.
  - [ ] Each import is classified as internal file, workspace package, external package, Node built-in or unresolved.
  - [ ] Unresolved imports produce diagnostics.
  - [ ] Never runs repository code and never reads JavaScript config files (NFR-5).

### M1.6 Map files to components (ADR-0004)

Implement hybrid component inference in `packages/architecture-engine` (FR-A5).

- **Depends on:** M1.2, M1.5
- **Acceptance criteria:**
  - [ ] Applies the priority order: `archmind.config.json` components, then workspace packages, then first-level source folders, then `<root>`.
  - [ ] Every file belongs to exactly one component.
  - [ ] `archmind.config.json` is validated with zod and gives clear error messages.
  - [ ] ADR-0004 (component model) is written.

### M1.7 Build the component graph, metrics and cycles

Aggregate file imports into component dependencies with evidence, and compute metrics and cycles (FR-A6, FR-A7).

- **Depends on:** M1.6
- **Acceptance criteria:**
  - [ ] Each dependency has a weight and links to the file:line evidence for every import it aggregates.
  - [ ] External package dependencies are recorded per component.
  - [ ] Metrics per component: file count, LOC, fan-in, fan-out, instability.
  - [ ] Tarjan's algorithm detects cycles at component and file level.

### M1.8 Build deterministic snapshots

Assemble the versioned snapshot with deterministic IDs and a `contentHash` (FR-A8, NFR-1, NFR-2).

- **Depends on:** M1.7
- **Acceptance criteria:**
  - [ ] Records `engineVersion`, `parserVersion`, `configHash` and `commitSha` (when the repository is a Git repo).
  - [ ] Two runs on the same input produce an identical `contentHash`, verified by a test.
  - [ ] The snapshot passes schema validation.

### M1.9 Create the `archmind analyze` CLI

Create `apps/cli` and fixture repositories in `tests/fixtures`.

- **Depends on:** M1.8
- **Acceptance criteria:**
  - [ ] `archmind analyze <path> --out snapshot.json` writes the snapshot file.
  - [ ] `--format summary` prints components, dependencies, cycles and diagnostics.
  - [ ] Fixtures cover a single package, a monorepo, path aliases, a cycle and malformed files.
  - [ ] Verified on at least two real open-source TypeScript monorepos.
  - [ ] Performance is measured against NFR-7 and recorded.

## M2 — Local architecture explorer

### M2.1 Define explorer API contracts

Define zod view models in `packages/contracts` for the component graph, file graph, component detail and dependency evidence.

- **Depends on:** M1.8
- **Acceptance criteria:**
  - [ ] An OpenAPI document is generated from the contracts.
  - [ ] Unit tests cover mapping a snapshot to each view model.

### M2.2 Create the read-only explorer API

Create `apps/api` (NestJS) with a `SnapshotReader` port and a file-system adapter that reads from `ARCHMIND_SNAPSHOT_DIR`.

- **Depends on:** M2.1
- **Acceptance criteria:**
  - [ ] Implements the M2 endpoints under `/api/workspaces/local/...`.
  - [ ] Errors use a consistent shape. Inputs are validated.
  - [ ] Swagger UI is served at `/api/docs`.
  - [ ] Integration tests run against fixture snapshots.

### M2.3 Build the architecture explorer UI

Create `apps/web` (Next.js, Tailwind, React Flow) with the component graph (FR-E1, FR-E2).

- **Depends on:** M2.2
- **Acceptance criteria:**
  - [ ] Auto-layout, zoom, pan and search.
  - [ ] Cycle highlighting and filters by component and dependency kind.
  - [ ] Loading, empty and error states.
  - [ ] Usable with 300 components and 3,000 dependencies.

### M2.4 Add component and dependency details

Add a side panel and drill-down navigation (FR-E3, FR-E4, FR-E5).

- **Depends on:** M2.3
- **Acceptance criteria:**
  - [ ] The panel shows metrics, files, inbound and outbound dependencies.
  - [ ] Dependency evidence is listed as file:line locations.
  - [ ] Drill-down from a component to its file graph works.
  - [ ] An accessible list alternative to the graph exists (NFR-12).
  - [ ] A Playwright smoke test covers the flow.

## M3 — Persistent analysis service

### M3.1 Create the database schema

Add Docker Compose with Postgres, and `packages/database` with a Prisma schema for Workspace, Repository, AnalysisRun, ArchitectureSnapshot and the snapshot child tables.

- **Depends on:** M2.2
- **Acceptance criteria:**
  - [ ] Migrations are committed. A default workspace is seeded.
  - [ ] Indexes support the explorer query patterns.
  - [ ] Prisma models are not exported from the package; repositories return domain types.
  - [ ] Snapshot rows have no update paths (NFR-3).

### M3.2 Add the job queue and worker ⚠ Approval (ADR-0005)

Add a `JobQueue` port, a pg-boss adapter, and `apps/worker`.

- **Depends on:** M3.1
- **Acceptance criteria:**
  - [ ] Supports `enqueue` with an idempotency key.
  - [ ] Bounded retries with backoff, a per-job timeout and limited concurrency.
  - [ ] Run status follows `queued → running → succeeded | failed`.
  - [ ] ADR-0005 is written.

### M3.3 Persist analysis snapshots

Implement the `analyse-repository` job: read the source, analyse it, and publish the snapshot in a single transaction using batched inserts.

- **Depends on:** M3.2
- **Acceptance criteria:**
  - [ ] An existing idempotency key reuses the snapshot (FR-R4, NFR-4).
  - [ ] Killing the worker mid-run leaves no partial snapshot.
  - [ ] Temporary files are always cleaned up.

### M3.4 Expose repository and analysis APIs

Add workspace-scoped repository, analysis run and snapshot endpoints. Switch the explorer to a Postgres-backed `SnapshotReader`.

- **Depends on:** M3.3
- **Acceptance criteria:**
  - [ ] Implements the M3 endpoints.
  - [ ] `POST /analyses` returns `202`.
  - [ ] Snapshot lists are cursor-paginated.
  - [ ] Registering a local-path repository is only possible in development mode.

### M3.5 Build the repository and run UI

Add a repository list, an "add repository" flow, an analysis trigger, run status polling and a snapshot picker (FR-R1 to FR-R3).

- **Depends on:** M3.4, M2.4
- **Acceptance criteria:**
  - [ ] Covers the end-to-end flow: add a repository, analyse it, explore it, and open a past snapshot.
  - [ ] Failed runs show their diagnostics.

## M4 — GitHub and multi-user

### M4.1 Register the GitHub App ⚠ Approval (ADR-0006)

Create the GitHub App with `contents: read` and `metadata: read` permissions only. Handle `installation` and `installation_repositories` webhooks.

- **Depends on:** —
- **Acceptance criteria:**
  - [ ] Webhook signatures are verified.
  - [ ] The private key and secrets come from environment variables only (NFR-9).
  - [ ] Tests cover webhook verification.

### M4.2 Implement sign-in with GitHub ⚠ Approval (ADR-0006)

Add GitHub App user authorisation (OAuth), the User and Session tables, and logout (FR-I1).

- **Depends on:** M4.1, M3.4
- **Acceptance criteria:**
  - [ ] Validates the OAuth `state` parameter.
  - [ ] Stores a hashed session token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie.
  - [ ] CSRF protection on state-changing requests.
  - [ ] No GitHub token ever reaches the browser.

### M4.3 Add workspaces and authorisation ⚠ Approval (ADR-0007)

Add the WorkspaceMember table with owner and member roles, create a personal workspace on first sign-in, and add a `WorkspaceMemberGuard` (FR-I2, FR-I4).

- **Depends on:** M4.2
- **Acceptance criteria:**
  - [ ] Every tenant route is guarded.
  - [ ] Every query filters by `workspaceId`.
  - [ ] A cross-tenant access test matrix covers all routes (NFR-8).

### M4.4 Analyse GitHub repositories

Link installations to workspaces, add repository selection, and add a `GitHubSourceProvider` that downloads the tarball at a commit (FR-I3, FR-A9).

- **Depends on:** M4.3, M3.3
- **Acceptance criteria:**
  - [ ] The API verifies with GitHub that the user can access an installation before linking it.
  - [ ] Archive extraction rejects path traversal and symlinks and enforces size limits (NFR-5, NFR-6).
  - [ ] Uninstalling the app disables the affected repositories.

### M4.5 Review auth and tenant isolation ⚠ Approval

Human security review of authentication, sessions, tokens, tenant isolation and untrusted source handling.

- **Depends on:** M4.4
- **Acceptance criteria:**
  - [ ] Findings are documented and resolved.
  - [ ] Signed off before any external user is invited.

## M5 — Governance and findings

### M5.1 Define the governance rule model (ADR-0008)

Add a `rules` section to `archmind.config.json`: layers, forbidden dependencies, no cycles, thresholds and restricted external packages (FR-G1).

- **Depends on:** M1.8
- **Acceptance criteria:**
  - [ ] Validated with zod, with clear and actionable errors.
  - [ ] The config hash includes the rules.
  - [ ] ADR-0008 is written.

### M5.2 Implement the rule evaluation engine

Create `packages/governance-engine`: a pure function `(snapshot, rules) → findings`, plus built-in default rules (FR-G2, FR-G3).

- **Depends on:** M5.1
- **Acceptance criteria:**
  - [ ] Each finding has a rule ID and version, severity, message, evidence (component, dependency or file:line) and a stable fingerprint.
  - [ ] Unit tests cover every rule type.
  - [ ] Fingerprints stay stable across unrelated code changes.

### M5.3 Generate and expose findings

Add the `evaluate-rules` worker job, the `Finding` table and the findings API (FR-G4).

- **Depends on:** M5.2, M4.5
- **Acceptance criteria:**
  - [ ] Runs as a separate job; a rule failure never invalidates the snapshot.
  - [ ] Findings are marked new, existing or resolved compared with the previous snapshot.
  - [ ] The findings list is paginated and filterable.

### M5.4 Build the findings UI

Add a findings list, a finding detail view, graph highlighting, commit-pinned GitHub links and a health summary (FR-G5, FR-E6).

- **Depends on:** M5.3
- **Acceptance criteria:**
  - [ ] You can jump from a finding to the graph and to the exact source line on GitHub.
  - [ ] Covered by a Playwright test.

### M5.5 Add the `archmind check` CLI command

Evaluate rules locally for use in CI (FR-G6).

- **Depends on:** M5.2
- **Acceptance criteria:**
  - [ ] Exits non-zero when violations meet or exceed `--fail-on <severity>`.
  - [ ] ArchMind's own CI runs `archmind check` against this repository.

## M6 — AI architecture assistant

### M6.1 Define read-only architecture tools

Create `packages/agent-runtime` with tools bound server-side to `(workspaceId, snapshotId)`. The tools call the application query services.

- **Depends on:** M5.3
- **Acceptance criteria:**
  - [ ] Tool inputs and outputs are zod-validated.
  - [ ] No tool can write data.
  - [ ] Tests prove a tool cannot reach another workspace or snapshot.

### M6.2 Build the assistant with cited answers ⚠ Approval (ADR-0009)

Build a LangGraph.js agent that uses a provider configured via the LangChain chat model interface, and returns structured answers with citations (FR-AI2, FR-AI3).

- **Depends on:** M6.1
- **Acceptance criteria:**
  - [ ] Citations not found in this run's tool results are removed and logged.
  - [ ] Returns an explicit insufficient-evidence answer when appropriate.
  - [ ] Enforces step, token and time limits.
  - [ ] Repository content is never treated as instructions.

### M6.3 Add the conversations API and chat UI

Add the Conversation and Message tables, an SSE message endpoint, a chat panel and an "Explain this finding" action (FR-AI1, FR-AI4, FR-AI5).

- **Depends on:** M6.2, M5.4
- **Acceptance criteria:**
  - [ ] Responses stream.
  - [ ] Citations link into the explorer.
  - [ ] Conversations are scoped to a workspace and snapshot.
  - [ ] An AI failure shows a clear error and leaves the rest of the UI working (NFR-10).

### M6.4 Trace agent runs and usage

Add AgentRun and ToolCall tables, per-workspace usage limits and a trace view.

- **Depends on:** M6.2, M6.3
- **Acceptance criteria:**
  - [ ] Records model, tokens, cost, latency, and tool inputs and outputs.
  - [ ] Enforces usage limits.
  - [ ] No secrets appear in traces.

### M6.5 Create the assistant evaluation harness

Add a fake model for tests, a golden question set over fixture snapshots, and an opt-in live evaluation script.

- **Depends on:** M6.2
- **Acceptance criteria:**
  - [ ] Ordinary CI never calls a real LLM.
  - [ ] The golden set passes with the fake model.

## M7 — Beta

### M7.1 Add snapshot history and comparison

Add snapshot comparison and optional analysis on push to the default branch (FR-R5, FR-R6).

- **Depends on:** M5.4
- **Acceptance criteria:**
  - [ ] The comparison shows added and removed components and dependencies, metric changes, and new and resolved findings.
  - [ ] Push-triggered analysis is idempotent.

### M7.2 Improve onboarding and UX

Add guided onboarding (install the app, select a repository, run the first analysis), starter `archmind.config.json` generation and an accessibility pass.

- **Depends on:** M6.3
- **Acceptance criteria:**
  - [ ] A new user reaches their first explored snapshot without documentation.
  - [ ] Core flows are keyboard-navigable.

### M7.3 Add observability

Create `packages/observability`: structured logging (pino), correlation IDs, health checks, error monitoring, and metrics for analysis duration and failures (NFR-11).

- **Depends on:** M3.2
- **Acceptance criteria:**
  - [ ] Every request and analysis run can be traced through the logs.
  - [ ] Source code and secrets are never logged.

### M7.4 Deploy the hosted environment ⚠ Approval (ADR-0010)

Add Dockerfiles for the API, web app and worker; choose a cloud host; set up managed Postgres, secrets management, backups, staging and production, and continuous deployment.

- **Depends on:** M4.5, M7.3
- **Acceptance criteria:**
  - [ ] Deployments are automated.
  - [ ] Restoring from backup has been verified.
  - [ ] Secrets come from a secret manager.

### M7.5 Harden with end-to-end and security checks

Add Playwright journeys, rate limiting, dependency auditing, data retention and workspace deletion.

- **Depends on:** M6.3, M7.4
- **Acceptance criteria:**
  - [ ] Journeys cover sign-in, workspace, GitHub connection, analysis, exploration, findings and asking a question.
  - [ ] Deleting a workspace removes all of its data.

### M7.6 Run a pilot with early teams

Onboard early engineering teams, collect feedback and agree post-beta priorities.

- **Depends on:** M7.1, M7.2, M7.5
- **Acceptance criteria:**
  - [ ] At least one external team uses ArchMind on a real repository.
  - [ ] Feedback and the next priorities are documented.
