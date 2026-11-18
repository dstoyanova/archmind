# ArchMind — Development Roadmap

ArchMind is built in this order:

1. **Analysis first.** The deterministic analysis engine and explorer come first.
2. **Local governance.** Rules and findings follow straight after, while everything still runs locally. This answers _"what should I be concerned about?"_ before any investment in persistence, authentication or hosting.
3. **Platform.** Persistence, then GitHub with teams and a hosted staging environment.
4. **AI.** The assistant comes last, so it can rely on deterministic facts and findings.

Every milestone ends with a **working, demoable product**. No milestone consists only of infrastructure.

- Requirements, architecture and rationale: [MVP implementation plan](plans/mvp-implementation-plan.md).
- Tasks and acceptance criteria: [backlog](BACKLOG.md).

| Milestone | Name                        | Working product at the end                                                           |
| --------- | --------------------------- | ------------------------------------------------------------------------------------ |
| M1        | Local analysis CLI          | `archmind analyze ./repo` produces an architecture snapshot and summary.             |
| M2        | Local architecture explorer | Browse any analysed repository as an interactive, hierarchical graph in the browser. |
| M3        | Local governance            | `archmind check` and the explorer show rule violations and risks, with evidence.     |
| M4        | Persistent analysis service | Analyse repositories in the background, with history and new/resolved findings.      |
| M5        | GitHub, teams and staging   | Teammates sign in on a hosted staging environment and explore private repositories.  |
| M6        | AI architecture assistant   | Ask questions about the architecture and get answers that cite evidence.             |
| M7        | Beta                        | A production, monitored product with comparison and onboarding, ready for pilots.    |

## M1 — Local analysis CLI

**Goal:** prove the analysis engine on real TypeScript repositories.

- [x] Monorepo, shared tooling configuration and CI.
- [x] Domain model, plus snapshot and config schemas (zod).
- [x] Source file discovery and file roles (source, test, story, script, config).
- [x] Import extraction with import kinds (including type-only), and exported-symbol extraction.
- [x] Module resolution without installing dependencies, with resolution statistics.
- [x] Hierarchical component mapping: packages, then folders, overridable by `archmind.config.json`.
- [x] Dependency graph with evidence, metrics and cycles, computed on the production graph.
- [x] Reproducible, versioned snapshot builder.
- [x] `archmind analyze` CLI, fixture repositories and a resolution benchmark.

**Outcome:** `archmind analyze <path> --out snapshot.json` describes the architecture of a local TypeScript repository.

**Exit criteria:**

- Every fixture matches its expected graph.
- On at least two open-source monorepos, at most 2% of imports are unresolved and at least 95% of internal edges agree with a reference tool.
- The same files produce the same `contentHash` in any directory.
- Malformed files produce diagnostics, never crashes.
- Performance has been measured.

## M2 — Local architecture explorer

**Goal:** make snapshots explorable and check that the inferred hierarchy makes sense to people.

- [x] Shared explorer graph functions in `domain`: cycles on any projected graph, and file-level projection.
- [x] Explorer API contracts and OpenAPI.
- [x] Read-only NestJS API serving validated snapshot files from a directory.
- [ ] Interactive hierarchical graph: auto-layout, expand and collapse, search, cycle highlighting, and filters for file role and type-only imports.
- [ ] Snapshot overview, component details, dependency evidence and drill-down to files.
- [ ] ArchMind's own `archmind.config.json`, with `componentRoots` and `analysis.exclude`.
- [ ] The inferred hierarchy is validated on real repositories.

**Outcome:** browse the architecture of any repository analysed in M1.

**Exit criteria:**

- ArchMind's own bounded contexts are visible as child components.
- The graph stays usable at around 300 components and 3,000 dependencies.

## M3 — Local governance

**Goal:** answer _"what should I be concerned about?"_ before any platform investment.

- [ ] Rule model in `archmind.config.json`: layers, forbidden dependencies, cycles, thresholds, restricted packages.
- [ ] Pure governance engine with built-in default rules, producing immutable rule evaluations.
- [ ] Baseline comparison, marking findings as new, existing or resolved.
- [ ] `archmind check` for local and CI use.
- [ ] Findings, health summary and graph highlighting in the local explorer.

**Outcome:** risks and rule violations are visible with file-level evidence, both locally and in CI.

**Exit criteria:**

- Tests and type-only cycles do not produce default findings.
- `archmind check` fails on violations, and with a baseline reports only new ones.
- ArchMind's own CI passes `archmind check`.

## M4 — Persistent analysis service

**Goal:** turn the tool into a service with history, background processing and automatic baselines.

- [ ] PostgreSQL via Docker Compose. Relational core plus deduplicated snapshot documents. Seeded default workspace.
- [ ] Postgres-backed job queue (pg-boss), and a worker running analysis in an isolated child process with recovery of stuck runs.
- [ ] Idempotent, atomic snapshot persistence, including correct handling of uncommitted local changes.
- [ ] Persisted rule evaluations with automatic baseline selection.
- [ ] Repository, run, snapshot and findings APIs and UI.
- [ ] Structured logging with redaction.

**Outcome:** `docker compose up`, add a local repository, analyse it, and see its history and how its findings change over time.

**Exit criteria:**

- Killing the worker mid-run leaves no partial snapshot, and the run is recovered.
- Runs that exceed their memory or time limit fail cleanly.
- Logs contain no secrets or source.

## M5 — GitHub, teams and staging

**Goal:** real users and real repositories on a shared hosted environment, safely.

- [ ] GitHub App with minimal permissions, and sign in with GitHub.
- [ ] Workspaces, membership, invitations, and server-side authorisation on every route.
- [ ] Repository linking with per-user GitHub access checks, and disconnection handling.
- [ ] Analysis of GitHub repositories with safe archive extraction, and commit-pinned evidence links.
- [ ] Minimal hosted staging environment.
- [ ] Security review of auth, tokens, tenant isolation and untrusted source handling.

**Outcome:** an invited teammate signs in on staging and explores a private repository.

**Exit criteria:**

- Automated tests prove there is no cross-tenant access and that users cannot link repositories they can't access.
- The security review is signed off before any external user is invited.

## M6 — AI architecture assistant

**Goal:** natural-language exploration based on the architecture model and findings.

- [ ] AI data policy, and an AI opt-in per workspace.
- [ ] Read-only architecture query tools, scoped to a workspace and snapshot.
- [ ] LangGraph.js assistant whose claim-level citations are validated before the answer is shown.
- [ ] Chat with live progress, clickable citations and "Explain this finding".
- [ ] Agent tracing and usage limits.
- [ ] Evaluation harness and a live quality bar.

**Outcome:** users ask questions and get answers that cite evidence.

**Exit criteria:**

- The live evaluation meets the quality bar.
- Every displayed citation resolves.
- An AI failure never affects analysis or findings.

## M7 — Beta

**Goal:** a production, observable and secure product for early teams.

- [ ] Snapshot comparison, and optional analysis on push.
- [ ] Guided onboarding and starter config generation.
- [ ] Production environment with backups and continuous deployment.
- [ ] Metrics, error monitoring and alerting.
- [ ] End-to-end tests, rate limiting, data retention and workspace deletion.
- [ ] Pilot with early engineering teams.

**Outcome:** a usable MVP ready for real-world feedback.

**Exit criteria:**

- External teams onboard without help.
- Errors and slow analyses trigger alerts.
- Pilot feedback is collected and post-beta priorities are agreed.

## After beta

- Change impact analysis on pull requests.
- Ancestry-based baselines, and change-frequency hotspots from Git history.
- Moving workflows to Temporal when they become long-running or multi-step.
- Architecture health trends over time.
- Additional languages via Tree-sitter.
- Rule editing in the UI.
- Billing and usage plans.
