# ArchMind — Technical Architecture

> The [MVP implementation plan](plans/mvp-implementation-plan.md) proposes refinements to this document. Items marked _proposed_ are pending approval through the ADR named next to them.

## Architectural approach

Start with a **modular monolith** using TypeScript.

Keep domain boundaries explicit and components independently testable. Introduce distributed services only when there is a clear operational or scaling need.

## Technology stack

| Area                   | Technology                                             |
| ---------------------- | ------------------------------------------------------ |
| Language               | TypeScript                                             |
| Frontend               | Next.js, React                                         |
| Backend                | NestJS                                                 |
| API                    | REST, OpenAPI                                          |
| Validation, contracts  | zod                                                    |
| Database               | PostgreSQL                                             |
| ORM                    | Prisma                                                 |
| Code analysis          | TypeScript Compiler API, Tree-sitter                   |
| AI orchestration       | LangGraph.js                                           |
| Workflow orchestration | Temporal (later); pg-boss first (_proposed_, ADR-0007) |
| Graph visualisation    | React Flow                                             |
| Styling                | Tailwind CSS                                           |
| UI components          | shadcn/ui                                              |
| Authentication         | Clerk (_proposed_, ADR-0009)                           |
| Database hosting       | Neon (_under consideration_, ADR-0011)                 |
| Package manager        | pnpm                                                   |
| Monorepo tooling       | Turborepo                                              |
| Testing                | Vitest, Playwright                                     |
| CI/CD                  | GitHub Actions                                         |
| Containerisation       | Docker                                                 |

## Initial repository structure

```text
archmind/
├── apps/
│   ├── web/
│   ├── api/
│   ├── worker/
│   └── cli/
│
├── packages/
│   ├── domain/
│   ├── contracts/
│   ├── code-analysis/
│   ├── architecture-engine/
│   ├── governance-engine/
│   ├── agent-runtime/
│   ├── database/
│   ├── observability/
│   └── config/
│
├── infrastructure/
│   ├── docker/
│   ├── terraform/
│   └── environments/
│
├── docs/
│   ├── product/
│   ├── architecture/
│   ├── adr/
│   └── development/
│
├── tests/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/
│
├── .github/
│   └── workflows/
│   └── instructions/
│
├── package.json
└── pnpm-workspace.yaml
```

Packages should be introduced as needed rather than created as empty placeholders.

## Core components

- **Web:** User interface and architecture visualisation.
- **API:** Authentication, workspaces, repositories and application services. The read-only explorer serves one local workspace through file-based `SnapshotReader` and `EvaluationReader` adapters. The governance module links evaluations to snapshots by content hash and computes baseline status on read.
- **Worker:** Background repository analysis and processing. Analysis runs in an isolated child process (_proposed_, ADR-0007).
- **CLI:** Local analysis and rule checks, including in CI.
- **Code Analysis:** Parse source files and extract symbols and dependencies.
- **Architecture Engine:** Build the hierarchical component model, dependency graph, metrics and cycles.
- **Governance Engine:** Evaluate architectural rules against a snapshot using the shared domain projector and produce a separate immutable evaluation with findings. The configuration and evaluation contracts are defined in [ADR-0006](./adr/ADR-0006-governance-rules-and-evaluations.md). The engine does not read files or the clock; its result carries the snapshot's `createdAt` as metadata.
- **Agent Runtime:** Provide AI-assisted exploration and recommendations.
- **Database:** Persist workspaces, analyses, snapshots and findings.

## Analysis workflow

1. Receive an analysis request.
2. Retrieve the selected repository and commit.
3. Identify relevant source files.
4. Parse files and extract symbols and dependencies.
5. Resolve dependencies and construct an architecture model.
6. Persist an immutable architecture snapshot.
7. Evaluate architectural rules in a separate step that creates an immutable rule evaluation. Changing rules or upgrading the governance engine re-evaluates without re-analysing.
8. Make findings available to the user. Their status (new, existing or resolved) is computed against a baseline evaluation.

AI processing should be separate from deterministic analysis. An AI failure must not invalidate a completed architecture analysis.

## Key design principles

- Multi-tenant isolation and workspace-based access.
- Immutable architecture snapshots.
- Reproducible and versioned analysis.
- Idempotent and retryable background processing.
- Evidence-backed findings.
- Read-only AI tools by default.
- Clear separation between deterministic analysis and AI interpretation.

## Initial architectural constraints

- Dependency direction: component A depends on component B.
- Dependencies must reference components in the same snapshot.
- Findings must include evidence and their origin.
- Repository access must be authorised server-side.
- Source code must be treated as untrusted input.

## Performance and quality evidence

Measured on an Apple M4 laptop (headless Chromium 159, 1440 × 900) unless stated otherwise.

### Explorer rendering budgets

Provisional budgets: first render under 2 s, each expand or collapse under 500 ms, at 300 components and 3,000 dependencies. The Playwright fixture generates that snapshot (299 visible components, expanding `component-0` shows the last child, all 3,000 edges render). Timings start just before the click and end two animation frames after the expected graph is present and no longer busy. Requests go to the real local API, on production builds.

```bash
pnpm build --filter=@archmind/api --filter=@archmind/web
pnpm --filter @archmind/web exec playwright install chromium
ARCHMIND_ENFORCE_RENDER_BUDGET=1 pnpm --filter @archmind/web test:e2e --repeat-each=3
```

CI checks that the graph renders and logs the timings. `ARCHMIND_ENFORCE_RENDER_BUDGET=1` enforces the budgets on a comparable machine.

| Interaction  | Fixture, 3 runs | With 3,299 findings highlighted (M3.5) | Budget   |
| ------------ | --------------- | -------------------------------------- | -------- |
| First render | 414 to 454 ms   | 444 ms                                 | < 2 s    |
| Expand       | 398 to 399 ms   | 398 ms                                 | < 500 ms |
| Collapse     | 391 to 399 ms   | 399 ms                                 | < 500 ms |

The findings fixture has 299 coupling findings and 3,000 forbidden dependencies, loaded through one highlights request. It shows 298 badges while collapsed and 299 after expansion.

### Graph layout

The explorer uses ELK `layered` (direction right, `INCLUDE_CHILDREN`) when the projection has at most 500 internal edges, and `box` packing above that. Decided in M2 (review item E3) from screenshots of Vitest and Changesets at the M2.7 revisions.

- **Why not `box` everywhere.** `box` packs nodes by size and ignores edges, so dependencies become straight lines across the canvas and direction cannot be read. In Vitest, 168 edges cross a 90-package external grid.
- **Why layered.** Layers follow dependency direction, and an expanded parent stays one group around its children. External packages are not passed to ELK, because they only receive edges and the layered algorithm stacks such sinks in one tall column. They are placed in a grid beside the layout.
- **Why the 500-edge limit.** Layered layout cost grows steeply with edge count. On the 300-component fixture (Node, layout only): about 160 ms at 300 edges, 260 ms at 600, 1.1 s at 1,500 and 7.3 s at 2,981. Denser projections keep `box`, so the budgets still hold.
- **Real repositories.** Vitest and Changesets at the default depth render in 90 to 280 ms and expand or collapse in 90 to 120 ms (these include a 50 ms wait for the busy state to start).
- **Limitation.** Projections above 500 internal edges still have the `box` problems. Collapsing components or turning off internal dependencies reduces the edge count.

A Playwright test checks that expanded children stay inside their parent in the layered layout.

### Import resolution benchmark (M1)

`archmind resolution-benchmark --config <config.json>` compares ArchMind's internal-file edges with reference edges generated by `apps/cli/scripts/generate-reference-edges.mjs`, which uses `ts.resolveModuleName`, the same resolver the analyser uses. The agreement figure is therefore partly circular. The config lists repositories and an output path:

```json
{
  "repositories": [
    {
      "name": "repo-a",
      "repositoryPath": "/absolute/path/to/repo-a",
      "referenceEdgesPath": "/absolute/path/to/repo-a-reference-edges.json"
    }
  ],
  "outputPath": "/absolute/path/to/report.md"
}
```

Generate the reference edges with `node apps/cli/scripts/generate-reference-edges.mjs <repo> <reference-edges.json>`. For NFR-7, measure a large repository with `/usr/bin/time -l pnpm archmind analyze <repo> --out <snapshot.json> --format summary` (`-v` on Linux).

Results of 2026-11-17 (engine `0.3.0`, TypeScript parser `5.9.3`, Node 24.22.3, shallow clones at `vitest-dev/vitest@efba8cbf`, `changesets/changesets@9a035ec3` and `microsoft/vscode@acd59dfb`):

| Repository            |  Files | Duration | Unresolved rate (NFR-8: ≤ 2%) | Agreement (NFR-8: ≥ 95%) |         Peak memory |
| --------------------- | -----: | -------: | ----------------------------: | -----------------------: | ------------------: |
| vitest-dev/vitest     |  2,430 |    1.9 s |                         0.99% |                   95.02% | 472 MiB (both runs) |
| changesets/changesets |    164 |    0.2 s |                         0.00% |                  100.00% | 472 MiB (both runs) |
| microsoft/vscode      | 14,846 |   25.4 s |                             - |                        - |             2.1 GiB |

NFR-7 (under 2 minutes at 5,000 or more analysable files) is met by VS Code. As an independent check, the `internal-file` edges were compared with `dependency-cruiser@18.8.0`: 100.00% agreement on Changesets and 92.98% (Jaccard) on Vitest. The 186 differing Vitest edges come from tool limits: dependency-cruiser did not apply `~/` and `#` imports (124 edges only ArchMind reports), resolved `context` to a declaration file that ArchMind excludes, and resolved `@vitest/*` workspace imports to a package-root stub where ArchMind follows the `__vitest_source__` condition to `src/`.
