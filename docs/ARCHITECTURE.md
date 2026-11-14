# ArchMind — Technical Architecture

## Architectural approach

Start with a **modular monolith** using TypeScript.

Keep domain boundaries explicit and components independently testable. Introduce distributed services only when there is a clear operational or scaling need.

## Technology stack

| Area                   | Technology                           |
| ---------------------- | ------------------------------------ |
| Language               | TypeScript                           |
| Frontend               | Next.js, React                       |
| Backend                | NestJS                               |
| API                    | REST, OpenAPI                        |
| Database               | PostgreSQL                           |
| ORM                    | Prisma                               |
| Code analysis          | TypeScript Compiler API, Tree-sitter |
| AI orchestration       | LangGraph.js                         |
| Workflow orchestration | Temporal                             |
| Graph visualisation    | React Flow                           |
| Styling                | Tailwind CSS                         |
| Package manager        | pnpm                                 |
| Monorepo tooling       | Turborepo                            |
| Testing                | Vitest, Playwright                   |
| CI/CD                  | GitHub Actions                       |
| Containerisation       | Docker                               |

## Initial repository structure

```text
archmind/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
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
- **API:** Authentication, workspaces, repositories and application services.
- **Worker:** Background repository analysis and processing.
- **Code Analysis:** Parse source files and extract symbols and dependencies.
- **Architecture Engine:** Build architecture models and evaluate rules.
- **Agent Runtime:** Provide AI-assisted exploration and recommendations.
- **Database:** Persist workspaces, analyses, snapshots and findings.

## Analysis workflow

1. Receive an analysis request.
2. Retrieve the selected repository and commit.
3. Identify relevant source files.
4. Parse files and extract symbols and dependencies.
5. Resolve dependencies and construct an architecture model.
6. Persist an immutable architecture snapshot.
7. Evaluate architectural rules.
8. Generate findings and make results available to the user.

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
