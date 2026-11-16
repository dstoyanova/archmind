# ArchMind — Backlog

Implementation tasks grouped by [roadmap](ROADMAP.md) milestone. Requirement IDs (FR-_, NFR-_) and section references (§) refer to the [MVP implementation plan](plans/mvp-implementation-plan.md).

Each task is sized to be completed and reviewed on its own, and can be split into smaller issues when work starts. A task is done when its acceptance criteria are met, and type checking, linting and the relevant tests pass.

Tasks marked **⚠ Approval** need human approval, normally recorded as an ADR, before implementation starts.

## M1 — Local analysis CLI

### M1.1 Bootstrap the monorepo ⚠ Approval (ADR-0001, ADR-0002)

Set up the pnpm workspace, Turborepo, and `packages/config` with shared strict `tsconfig`, ESLint, Prettier and Vitest. Add GitHub Actions CI.

- **Depends on:** —
- **Acceptance criteria:**
  - [x] `pnpm install`, `pnpm lint`, `pnpm typecheck` and `pnpm test` work from the root.
  - [x] CI runs lint, typecheck and test on every pull request.
  - [x] ESLint import restrictions enforce the package dependency rules (§4.2).
  - [x] ADR-0001 and ADR-0002 are written. `ARCHITECTURE.md` is updated once they are accepted.

### M1.2 Define the domain model and schemas ⚠ Approval (ADR-0003, ADR-0004)

Create `packages/domain` with snapshot types, the component hierarchy, file roles, import kinds, invariants and `projectGraph`. Create `packages/contracts` with zod schemas for the snapshot and for `archmind.config.json` (analysis section).

- **Depends on:** M1.1
- **Acceptance criteria:**
  - [x] Domain code has no infrastructure dependencies.
  - [x] Invariants are validated: every dependency references components in the same snapshot, and every file has exactly one owning component.
  - [x] `projectGraph` collapses to any depth or expanded set, dropping internal edges and aggregating weights, counts and evidence.
  - [x] The hashing specification (NFR-1) is documented in ADR-0004. ADR-0003 (zod) is approved.

### M1.3 Discover source files and classify roles

Add the `SourceProvider` port and `LocalFsSourceProvider`, file discovery (FR-A1), and file-role classification (FR-A2, §4.7).

- **Depends on:** M1.2
- **Acceptance criteria:**
  - [x] Respects `.gitignore` and excludes `node_modules`, build output, `.d.ts` and generated files.
  - [x] Applies the default role patterns, with `fileRoles` overrides from the config.
  - [x] Enforces file-level limits (NFR-6). Skipped files produce diagnostics.
  - [x] Uses repo-relative POSIX paths in a deterministic order.
  - [x] Computes `sourceHash` from the discovered files plus the analysis section of the config (rules excluded).

### M1.4 Extract imports and symbols

Parse with `ts.createSourceFile` (no type-checking). Extract imports with their kinds (FR-A3) and exported symbols (FR-A4).

- **Depends on:** M1.3
- **Acceptance criteria:**
  - [x] Covers `static`, `re-export`, literal `dynamic`, literal `require` and `type-only` imports, including the all-specifiers-`type` case.
  - [x] Every import and symbol records its line and column.
  - [x] Malformed files produce a diagnostic, and analysis continues.

### M1.5 Resolve modules without installation

Implement the strategy in §4.6: a virtual host, tsconfig handling, workspace entry-point mapping, and external/built-in classification (FR-A5).

- **Depends on:** M1.4
- **Acceptance criteria:**
  - [x] Supports `paths`, project references, `extends` within the repository, and pnpm/npm/yarn workspaces.
  - [x] `extends` targets in uninstalled packages are skipped with a diagnostic.
  - [x] Workspace imports map `dist`/`exports` entry points back to source. Unmappable entries fall back to the package component with `WORKSPACE_ENTRY_UNMAPPED`.
  - [x] Never reads outside the repository root and never executes code (NFR-5).
  - [x] Records resolution statistics (NFR-8).

### M1.6 Map files to the component hierarchy ⚠ Approval (ADR-0005)

Implement the hierarchical hybrid model in `packages/architecture-engine` (FR-A6, §4.5).

- **Depends on:** M1.5
- **Acceptance criteria:**
  - [x] Applies, in order: configured components, packages (depth 1), folders under component roots (depth 2), `<root>`.
  - [x] `componentRoots` overrides produce child components (for example, NestJS modules).
  - [x] Every file has exactly one owning component.

### M1.7 Build the graph, metrics and cycles

Aggregate dependencies at the owning-component level, with evidence and counts by kind and role. Compute metrics and cycles on the production graph (FR-A7, FR-A8).

- **Depends on:** M1.6
- **Acceptance criteria:**
  - [x] Metrics per component are computed at its own depth.
  - [x] Tarjan cycles are found at each hierarchy level and at file level.
  - [x] Test-only cycles are excluded. Cycles that exist only through type-only imports are flagged `typeOnly`.
  - [x] External dependencies are recorded per component.

### M1.8 Build reproducible snapshots

Assemble the versioned snapshot with deterministic IDs and the `contentHash` (FR-A9, NFR-1, NFR-2).

- **Depends on:** M1.7
- **Acceptance criteria:**
  - [x] Two runs on the same repository, and the same repository copied to a different directory, produce an identical `contentHash`. Covered by tests.
  - [x] Source metadata (commit SHA, branch, `commitTimestamp`, `workingTreeDirty`) is recorded but not hashed.
  - [x] The snapshot passes schema and invariant validation.

### M1.9 Create the `archmind analyze` CLI and resolution benchmark

Create `apps/cli`, fixture repositories with expected graphs, and the dev-only resolution benchmark (§4.6).

- **Depends on:** M1.8
- **Acceptance criteria:**
  - [x] `archmind analyze <path> --out snapshot.json` writes the snapshot. `--format summary` prints components, dependencies, cycles, resolution statistics and diagnostics.
  - [x] Fixtures cover: single package, monorepo with `dist` entry points, path aliases, missing `extends` base, cycles (runtime, type-only and test-only), malformed files.
  - [x] On at least two open-source monorepos, the unresolved rate is at most 2% and agreement with the reference tool is at least 95%. Results are recorded in `docs/development/`.
  - [x] Performance is measured against NFR-7.

## M2 — Local architecture explorer

### M2.1 Define explorer API contracts

Define zod view models for the projected component graph, file graph, component detail and dependency evidence, and generate OpenAPI from them.

- **Depends on:** M1.8
- **Acceptance criteria:**
  - [ ] View models support depth, expanded components, role filters and the type-only toggle.
  - [ ] Unit tests cover the mappings.

### M2.2 Create the read-only explorer API

Create `apps/api` (NestJS) with a file-based `SnapshotReader` adapter that reads from `ARCHMIND_SNAPSHOT_DIR`.

- **Depends on:** M2.1
- **Acceptance criteria:**
  - [ ] Implements the M2 endpoints under `/api/workspaces/local/...`.
  - [ ] Validates input with zod pipes and returns consistent errors.
  - [ ] Serves Swagger UI at `/api/docs`.
  - [ ] Integration tests run against fixture snapshots.

### M2.3 Build the architecture explorer UI

Create `apps/web` (Next.js, Tailwind, shadcn/ui, React Flow) with the hierarchical graph (FR-E1, FR-E2).

- **Depends on:** M2.2
- **Acceptance criteria:**
  - [ ] shadcn/ui is initialised in `apps/web`. UI uses its components. Custom components exist only where shadcn/ui has no equivalent, such as React Flow nodes.
  - [ ] Auto-layout, expand and collapse, zoom, pan and search.
  - [ ] Cycle highlighting, and filters for dependency kind, file role (tests hidden by default) and type-only imports.
  - [ ] Loading, empty and error states.
  - [ ] Usable with 300 components and 3,000 dependencies.

### M2.4 Add component and dependency details

Add a side panel and drill-down navigation (FR-E3, FR-E4, FR-E5).

- **Depends on:** M2.3
- **Acceptance criteria:**
  - [ ] The panel shows metrics, files, child components, inbound and outbound dependencies, and evidence (file:line, kind).
  - [ ] Drill-down from a component to its file graph works.
  - [ ] An accessible list alternative exists (NFR-14).
  - [ ] A Playwright smoke test covers the flow.

## M3 — Local governance

### M3.1 Define the governance rule model ⚠ Approval (ADR-0006)

Add the `rules` section of `archmind.config.json`: layers, forbidden dependencies, no cycles, thresholds and restricted packages. Rules can target any hierarchy level and opt in to tests or type-only imports (FR-G1, FR-G4).

- **Depends on:** M1.8
- **Acceptance criteria:**
  - [ ] Validated with zod, with actionable error messages.
  - [ ] `rulesHash` covers only the `rules` section.
  - [ ] ADR-0006 defines rule evaluations as separate, immutable records.

### M3.2 Implement the governance engine

Create `packages/governance-engine`: a pure `evaluate(snapshot, rules, version)` that returns a `RuleEvaluation`, plus default rules (FR-G2, FR-G3).

- **Depends on:** M3.1
- **Acceptance criteria:**
  - [ ] Each finding has a rule ID and version, severity, message, evidence and fingerprint.
  - [ ] Fingerprints use component paths and dependency endpoints, never line numbers, and are tested to stay stable across unrelated edits.
  - [ ] Default rules ignore test files and `typeOnly` cycles.
  - [ ] Unit tests cover every rule type.

### M3.3 Add the `archmind check` CLI command

Evaluate rules for a path or an existing snapshot. Write an evaluation document and compare it with an optional baseline (FR-G5, FR-G7).

- **Depends on:** M3.2, M1.9
- **Acceptance criteria:**
  - [ ] `--fail-on <severity>` sets the exit code. `--baseline <evaluation.json> --new-only` counts only new findings.
  - [ ] `compareEvaluations` (in `domain`) classifies findings as new, existing or resolved, and flags `rulesChanged`.
  - [ ] Editing only rules reuses the existing snapshot.
  - [ ] ArchMind's own CI runs `archmind check` and passes.

### M3.4 Serve findings from the explorer API

Add a file-based `EvaluationReader` and the M3 endpoints: evaluations, findings with an optional baseline, finding detail and health summary.

- **Depends on:** M3.3, M2.2
- **Acceptance criteria:**
  - [ ] Findings are paginated and filterable.
  - [ ] Status is computed on read when a baseline is given.
  - [ ] Integration tests run against violation fixtures.

### M3.5 Build the findings UI

Add a findings list and detail view, graph highlighting and a health summary (FR-G6).

- **Depends on:** M3.4, M2.4
- **Acceptance criteria:**
  - [ ] You can jump from a finding to the affected components and to the evidence.
  - [ ] Covered by a Playwright test.

## M4 — Persistent analysis service

### M4.1 Create the database schema and storage model ⚠ Approval (ADR-0008)

Add Docker Compose with Postgres, and `packages/database` with the M4 entities (§4.8), `SnapshotDocumentStore` and a seeded default workspace.

- **Depends on:** M3.4
- **Acceptance criteria:**
  - [ ] Only the relational core is relational. Snapshot documents are gzip-compressed and unique per `(repositoryId, contentHash)`.
  - [ ] Snapshot, evaluation and finding rows have no update paths (NFR-3).
  - [ ] Prisma models are not exported from the package.
  - [ ] Indexes support the explorer and findings queries.

### M4.2 Add the job queue and isolated analysis worker ⚠ Approval (ADR-0007)

Add the `JobQueue` port, a pg-boss adapter and `apps/worker`. Analysis runs in a forked child process (§4.10).

- **Depends on:** M4.1
- **Acceptance criteria:**
  - [ ] The child process gets a memory cap, a wall-clock timeout enforced by the parent, and no credentials in its environment.
  - [ ] The parent sends a heartbeat. The reaper fails stale `running` runs with `WORKER_LOST` and re-enqueues them within the retry budget.
  - [ ] Tests prove that exceeding the time or memory limit fails the run while the worker stays healthy.

### M4.3 Persist analysis snapshots

Implement the `analyse-repository` job with idempotency by source identity (NFR-4) and atomic publishing.

- **Depends on:** M4.2
- **Acceptance criteria:**
  - [ ] Unchanged source reuses the snapshot. An uncommitted local edit creates a new snapshot.
  - [ ] Identical `contentHash` values share one snapshot document.
  - [ ] Killing the worker mid-run leaves no partial snapshot. Temporary files are always cleaned up.

### M4.4 Persist rule evaluations and baselines

Implement the `evaluate-rules` job, re-evaluation, and automatic baseline selection (§4.9, FR-R5).

- **Depends on:** M4.3
- **Acceptance criteria:**
  - [ ] A rule failure never affects the snapshot.
  - [ ] Upgrading the governance engine re-evaluates without re-analysis.
  - [ ] Baseline selection works for the tracked branch, other branches and uncommitted local changes, and handles out-of-order analyses. Covered by tests.

### M4.5 Expose repository, run and findings APIs

Add the M4 endpoints, and switch the explorer and findings readers to the database.

- **Depends on:** M4.4
- **Acceptance criteria:**
  - [ ] `POST /analyses` returns `202`. Lists are cursor-paginated.
  - [ ] Registering a local-path repository is only possible in development mode.
  - [ ] File-level views load snapshot documents through a bounded cache.

### M4.6 Build the repository and run UI

Add a repository list, an "add repository" flow, an analysis trigger, run status, snapshot history, and findings with new/resolved status (FR-R1 to FR-R3).

- **Depends on:** M4.5, M3.5
- **Acceptance criteria:**
  - [ ] Covers the end-to-end flow: add a repository, analyse it, explore it, view findings and open a past snapshot.
  - [ ] Failed runs show their reason and diagnostics.

### M4.7 Add structured logging with redaction

Create `packages/observability` with a pino logger, correlation IDs and redaction (NFR-12).

- **Depends on:** M4.2
- **Acceptance criteria:**
  - [ ] Every request and run can be traced through the logs.
  - [ ] Tests prove that tokens, secrets and source content are redacted.

## M5 — GitHub, teams and staging

### M5.1 Register the GitHub App ⚠ Approval (ADR-0009)

Create separate development and staging GitHub Apps with `contents: read` and `metadata: read` only. Handle installation and repository webhooks.

- **Depends on:** M4.5
- **Acceptance criteria:**
  - [ ] Webhook signatures are verified.
  - [ ] Secrets come from the environment only (NFR-10).
  - [ ] The local development webhook setup is documented in `docs/development/`.

### M5.2 Implement sign-in with GitHub ⚠ Approval (ADR-0009)

Add GitHub App user authorisation, User, Session and encrypted `GitHubUserToken`, and logout (FR-I1).

> **Before starting:** Clerk (email and password, plus Sign in with GitHub) is the preferred provider. Present it to the human, resolve the open questions in the plan's §4.13, and get ADR-0009 approved. If Clerk is approved, the criteria below change: Clerk owns sessions and sign-in, and we own server-side token verification, user mapping and the GitHub access token handling.

- **Depends on:** M5.1
- **Acceptance criteria:**
  - [ ] Validates the OAuth `state` parameter.
  - [ ] Stores a hashed session token in a `httpOnly`, `Secure`, `SameSite=Lax` cookie.
  - [ ] CSRF protection on state-changing requests.
  - [ ] Tokens are encrypted at rest, refreshed on expiry, and never reach the browser.

### M5.3 Add workspaces, membership and invitations ⚠ Approval (ADR-0010)

Add WorkspaceMember, Invitation and `WorkspaceMemberGuard`, and create a personal workspace on first sign-in (FR-I2, FR-I3, FR-I7).

- **Depends on:** M5.2
- **Acceptance criteria:**
  - [ ] Invitations are single-use, expire after 7 days, and can only be accepted by the invited GitHub login.
  - [ ] Only owners manage members and invitations. Removing a member takes effect on their next request.
  - [ ] A cross-tenant access test matrix covers every route (NFR-9).

### M5.4 Connect and analyse GitHub repositories

Add installation linking, repository selection with per-user access checks, `GitHubSourceProvider` with safe extraction, disconnection handling, and commit-pinned links (FR-I4 to FR-I6, FR-A10, FR-E6).

- **Depends on:** M5.3, M4.3
- **Acceptance criteria:**
  - [ ] A user cannot link an installation or repository they cannot access. Access is re-checked when they trigger an analysis.
  - [ ] Extraction applies NFR-6: only relevant files are extracted, links and special files are skipped with diagnostics, and traversal entries fail the run. Malicious archive fixtures are tested.
  - [ ] Uninstalling the App, or removing a repository from it, disconnects the repository.
  - [ ] The connect screen states that all workspace members will see the repository's architecture data.

### M5.5 Deploy the staging environment ⚠ Approval (ADR-0011)

Add Dockerfiles for `api`, `web` and `worker`, a hosting provider, managed Postgres, secrets management, HTTPS and deployment from `main`.

> **Before starting:** Neon is under consideration for managed Postgres. Present it with ADR-0011 and check:
>
> - Use Neon's direct (unpooled) connection for Prisma migrations, and verify pg-boss against the pooled connection or use the direct one.
> - Use a separate Neon project or branch for staging, with its own secrets.
> - Check scale-to-zero cold starts against worker and job latency.
> - Keep Neon-specific features out of application code.

- **Depends on:** M5.1, M4.7
- **Acceptance criteria:**
  - [ ] Staging is reachable at a public HTTPS URL, with GitHub callbacks and webhooks working.
  - [ ] The worker container has a memory limit.
  - [ ] Deployment is automated.

### M5.6 Review auth, tenant isolation and source handling ⚠ Approval

A human security review of authentication, sessions, tokens, invitations, repository access, tenant isolation, archive handling and the analysis process.

- **Depends on:** M5.4, M5.5
- **Acceptance criteria:**
  - [ ] Findings are documented and resolved.
  - [ ] Signed off before any external user is invited.

## M6 — AI architecture assistant

### M6.1 Define the AI data policy and opt-in ⚠ Approval (ADR-0012)

Choose the first provider, write the data policy, and add the workspace AI setting with an opt-in screen (FR-AI1).

- **Depends on:** M5.6
- **Acceptance criteria:**
  - [ ] AI is off by default. Only owners can enable it, on a screen that names the provider and lists the data sent.
  - [ ] The provider is configured for no training on customer data and minimal retention, where offered.

### M6.2 Define the read-only architecture tools

Add `packages/agent-runtime` with `ArchitectureQueryPort`, implemented by `apps/api` query services, and the §4.12 tools.

- **Depends on:** M5.6
- **Acceptance criteria:**
  - [ ] Tool inputs and outputs are zod-validated.
  - [ ] No tool writes data or returns file contents.
  - [ ] Tests prove a tool cannot reach another workspace or snapshot.

### M6.3 Build the assistant with validated citations

Build a LangGraph.js agent with a claim-level answer contract, citation validation, one retry, and an insufficient-evidence response (FR-AI3, FR-AI4).

- **Depends on:** M6.1, M6.2
- **Acceptance criteria:**
  - [ ] No claim without a valid citation is ever returned.
  - [ ] Removed claims are logged.
  - [ ] Limits on steps, tokens and time are enforced.
  - [ ] Repository content is never treated as instructions.
  - [ ] The agent refuses to run when AI is disabled for the workspace.

### M6.4 Add conversations and the chat UI

Add Conversation and Message tables, an SSE endpoint that streams progress and then the validated answer, a chat panel, and "Explain this finding" (FR-AI2, FR-AI5, FR-AI6).

- **Depends on:** M6.3, M4.6
- **Acceptance criteria:**
  - [ ] Progress streams live, and citations link into the explorer.
  - [ ] Conversations are scoped to a workspace and snapshot.
  - [ ] An AI failure leaves the rest of the UI working (NFR-11).

### M6.5 Trace agent runs and usage

Add AgentRun and ToolCall tables, per-workspace usage limits and a trace view.

- **Depends on:** M6.3, M6.4
- **Acceptance criteria:**
  - [ ] Records provider, model, tokens, cost, latency, tool inputs and outputs, and removed claims.
  - [ ] Usage limits are enforced.
  - [ ] Traces contain no secrets.

### M6.6 Build the evaluation harness and quality bar

Add a fake model for tests, and a live evaluation set of at least 30 questions over 3 snapshots, scored automatically (§4.12).

- **Depends on:** M6.3
- **Acceptance criteria:**
  - [ ] Ordinary CI never calls a real LLM.
  - [ ] The live evaluation meets the bar: at least 80% expected facts cited, at least 90% correct insufficient-evidence responses, and zero unresolvable citations displayed.
  - [ ] 20 answers are reviewed manually. Results are recorded in `docs/development/`.

## M7 — Beta

### M7.1 Add snapshot comparison and analysis on push

Add snapshot comparison and optional analysis on push to the tracked branch (FR-R6, FR-R7).

- **Depends on:** M5.4
- **Acceptance criteria:**
  - [ ] The comparison shows added and removed components and dependencies, metric changes, and new and resolved findings.
  - [ ] Push-triggered analysis is idempotent.

### M7.2 Improve onboarding and UX

Add guided onboarding (install the App, select a repository, run the first analysis), starter `archmind.config.json` generation, and an accessibility pass.

- **Depends on:** M6.4
- **Acceptance criteria:**
  - [ ] A new user reaches their first explored snapshot without documentation.
  - [ ] Core flows are keyboard-navigable.

### M7.3 Add production observability

Extend `packages/observability` with metrics (analysis duration and failures, queue depth), error monitoring, health checks and alerting.

- **Depends on:** M5.5
- **Acceptance criteria:**
  - [ ] Failed and slow analyses trigger alerts.
  - [ ] Dashboards cover the API, worker and queue.

### M7.4 Deploy the production environment

Set up the production environment, backups, continuous deployment with promotion from staging, and a secret manager.

- **Depends on:** M5.6, M7.3
- **Acceptance criteria:**
  - [ ] Restoring from backup has been verified.
  - [ ] Deployment is automated and repeatable.

### M7.5 Harden with end-to-end and security checks

Add Playwright journeys, rate limiting, dependency auditing, retention policies for snapshots, documents and conversations, and workspace deletion.

- **Depends on:** M6.4, M7.4
- **Acceptance criteria:**
  - [ ] Journeys cover sign-in, invitation, GitHub connection, analysis, exploration, findings, enabling AI and asking a question.
  - [ ] Deleting a workspace removes all of its data.

### M7.6 Run a pilot with early teams

Onboard early engineering teams, collect feedback and agree post-beta priorities.

- **Depends on:** M7.1, M7.2, M7.5
- **Acceptance criteria:**
  - [ ] At least one external team uses ArchMind on a real repository.
  - [ ] Feedback and next priorities are documented.
