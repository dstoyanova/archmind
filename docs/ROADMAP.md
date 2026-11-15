# ArchMind — Development Roadmap

ArchMind is built **analysis-first**: the deterministic analysis engine comes first, then persistence, users, governance and AI are layered on top. Governance comes before the AI assistant, so the assistant can base its answers on deterministic facts and findings.

Every milestone ends with a **working, demoable product**. No milestone consists only of infrastructure.

- Requirements, architecture and rationale: [MVP implementation plan](plans/mvp-implementation-plan.md).
- Tasks and acceptance criteria: [backlog](BACKLOG.md).

| Milestone | Name                        | Working product at the end                                                  |
| --------- | --------------------------- | --------------------------------------------------------------------------- |
| M1        | Local analysis CLI          | `archmind analyze ./repo` produces an architecture snapshot and summary.    |
| M2        | Local architecture explorer | Browse any analysed repository as an interactive graph in the browser.      |
| M3        | Persistent analysis service | Add a repository, analyse it in the background and see analysis history.    |
| M4        | GitHub and multi-user       | Sign in with GitHub, connect a repository and explore it with teammates.    |
| M5        | Governance and findings     | See architectural risks and rule violations, with evidence.                 |
| M6        | AI architecture assistant   | Ask questions about the architecture and get answers that cite evidence.    |
| M7        | Beta                        | A hosted, monitored product with history and comparison, ready for pilots.  |

## M1 — Local analysis CLI

**Goal:** prove the analysis engine on real TypeScript repositories.

- [ ] Monorepo, shared tooling configuration and CI.
- [ ] Domain model and versioned snapshot schema.
- [ ] Source file discovery with ignore rules and limits.
- [ ] Import and exported-symbol extraction (TypeScript Compiler API).
- [ ] Module resolution: `tsconfig` paths, project references, workspaces.
- [ ] Hybrid component mapping: workspace packages and folders, overridable by `archmind.config.json`.
- [ ] Component dependency graph with evidence, metrics and cycle detection.
- [ ] Deterministic, versioned snapshot builder.
- [ ] `archmind analyze` CLI and fixture repositories.

**Outcome:** `archmind analyze <path> --out snapshot.json` describes the architecture of a local TypeScript repository.

**Exit criteria:**
- Works on every fixture and on at least two real open-source TypeScript monorepos.
- Running it twice produces the same `contentHash`.
- Malformed files produce diagnostics, never crashes.
- Performance has been measured against the target.

## M2 — Local architecture explorer

**Goal:** make snapshots explorable and check that the inferred components make sense to people.

- [ ] Explorer API contracts and OpenAPI.
- [ ] Read-only NestJS API serving snapshot files from a directory.
- [ ] Interactive component graph: auto-layout, search, filters, cycle highlighting.
- [ ] Component details, dependency evidence and drill-down to files.

**Outcome:** browse the architecture of any repository analysed in M1.

**Exit criteria:**
- `pnpm dev` with `ARCHMIND_SNAPSHOT_DIR` set lets you explore any M1 snapshot.
- The graph stays usable at around 300 components and 3,000 dependencies.

## M3 — Persistent analysis service

**Goal:** turn the tool into a service with history and background processing.

- [ ] PostgreSQL via Docker Compose and Prisma schema, with a seeded default workspace.
- [ ] Postgres-backed job queue (pg-boss) behind a `JobQueue` interface, and `apps/worker`.
- [ ] Atomic, immutable, idempotent snapshot persistence.
- [ ] Repository, analysis run and snapshot APIs.
- [ ] Repository and run UI. Explorer reads from Postgres.

**Outcome:** `docker compose up`, add a local repository, analyse it and browse its history.

**Exit criteria:**
- Re-analysing the same commit reuses the existing snapshot.
- Killing the worker mid-run leaves no partial snapshot.

## M4 — GitHub and multi-user

**Goal:** real users and real repositories, safely.

- [ ] GitHub App with minimal permissions and verified webhooks.
- [ ] Sign in with GitHub, using server-side sessions.
- [ ] Workspaces, membership and server-side authorisation on every route.
- [ ] Analysis of GitHub repositories at a specific commit, with safe archive extraction.
- [ ] Security review of auth, tokens, tenant isolation and untrusted source handling.

**Outcome:** a teammate signs in, connects a private repository and explores it.

**Exit criteria:**
- Automated tests prove there is no cross-tenant access.
- The security review is signed off before any external user is invited.

## M5 — Governance and findings

**Goal:** answer *"what should I be concerned about?"*

- [ ] Rule model in `archmind.config.json`: layers, forbidden dependencies, cycles, thresholds, restricted packages.
- [ ] Pure rule evaluation engine with built-in default rules.
- [ ] Findings with evidence and stable fingerprints, marked new, existing or resolved.
- [ ] Findings API and UI, graph highlighting, commit-pinned GitHub links, health summary.
- [ ] `archmind check` for local and CI use.

**Outcome:** users see architectural risks and violations, with file-level evidence.

**Exit criteria:**
- `archmind check` fails CI on a fixture that contains violations.
- ArchMind's own repository passes its rules.

## M6 — AI architecture assistant

**Goal:** natural-language exploration based on the architecture model and findings.

- [ ] Read-only architecture query tools, scoped to a workspace and snapshot.
- [ ] LangGraph.js assistant with validated citations and an "insufficient evidence" response.
- [ ] Streaming chat with clickable citations, and "Explain this finding".
- [ ] Agent run and tool call tracing, and usage limits.
- [ ] Evaluation harness with a fake model and a golden question set.

**Outcome:** users ask questions and get answers that cite evidence.

**Exit criteria:**
- Every citation resolves to an explorer link.
- An AI failure never affects analysis or findings.

## M7 — Beta

**Goal:** a hosted, observable and secure product for early teams.

- [ ] Snapshot history and comparison. Optional analysis on push.
- [ ] Guided onboarding and starter config generation.
- [ ] Structured logging, monitoring and health checks.
- [ ] Hosted staging and production environments, with backups and continuous deployment.
- [ ] End-to-end tests, rate limiting, data retention and workspace deletion.
- [ ] Pilot with early engineering teams.

**Outcome:** a usable MVP ready for real-world feedback.

**Exit criteria:**
- External teams onboard without help.
- Errors and slow analyses are visible in monitoring.
- Pilot feedback is collected and post-beta priorities are agreed.

## After beta

- Change impact analysis on pull requests.
- Migrate workflows to Temporal when they become long-running or multi-step.
- Architecture health trends over time.
- Additional languages via Tree-sitter.
- Rule editing in the UI.
- Billing and usage plans.
