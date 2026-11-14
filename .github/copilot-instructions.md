# ArchMind — GitHub Copilot Instructions

## 1. Project Overview

ArchMind is an AI-powered Software Architecture Intelligence Platform designed to help software engineering teams understand, analyse, govern and continuously improve their software architecture.

The platform analyses source code, repository structures, dependencies, architectural decisions and Git history to build a structured representation of a software system.

AI agents use this information to identify architectural risks, answer questions, evaluate proposed changes and recommend improvements.

### Product vision

Make software architecture observable, understandable and continuously improvable.

### Core principles

- Evidence before opinions.
- Deterministic analysis before AI interpretation.
- Explainability over black-box recommendations.
- Human approval for consequential decisions.
- Security and privacy by design.
- Strong architectural boundaries.
- Incremental development over premature complexity.

When implementing features, always consider whether they contribute to the product vision.

Avoid building generic AI functionality without a clear connection to software architecture intelligence.

## 2. Technology Stack

The initial technology stack is:

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

Do not introduce additional technologies without a clear technical justification.

Prefer existing dependencies and established project patterns over adding new libraries.

Technology decisions that affect the system architecture must be documented as Architecture Decision Records (ADRs).

## 3. Repository Structure

The intended monorepo structure is:

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

This is the intended structure. Follow the actual repository structure if implementation has not yet reached this state.

Do not create placeholder directories or packages without an implementation need.

## 4. AI-Assisted Development Workflow

When implementing a task:

1. Read the relevant project instructions.
2. Understand the existing implementation.
3. Identify affected modules and dependencies.
4. Review relevant ADRs.
5. Propose an implementation approach when architectural impact is significant.
6. Implement only the requested scope.
7. Add or update tests.
8. Run relevant validation.
9. Update documentation.
10. Summarise changes and limitations.

### Collaboration between agents

- Work on clearly defined tasks.
- Respect module ownership.
- Avoid editing the same files concurrently.
- Use explicit interfaces and contracts.
- Communicate integration assumptions.
- Do not introduce breaking changes without coordination.

### Human approval

Request human approval before:

- Changing architectural boundaries.
- Introducing new major dependencies.
- Changing authentication or authorisation.
- Modifying tenant isolation.
- Introducing new infrastructure services.
- Changing database ownership or core domain models.
- Performing destructive operations.

Do not assume approval simply because a change appears technically beneficial.

## 5. Definition of Done

A task is complete only when:

- Acceptance criteria are satisfied.
- Implementation follows project architecture.
- Type checking passes.
- Linting passes.
- Relevant tests pass.
- Security implications are considered.
- Documentation is updated where necessary.
- No unrelated changes are introduced.
- Known limitations are communicated.

Never claim tests passed unless they were actually executed.

Never hide failing tests or unresolved errors.

## 6. Final Guidance

When uncertain:

1. Prefer existing patterns.
2. Prefer simple solutions.
3. Preserve architectural consistency.
4. Avoid unnecessary abstractions.
5. Ask for clarification when requirements are ambiguous and the decision materially affects the implementation.
6. Explain significant trade-offs.
7. Document important decisions.

The goal is not to maximise code generation.

The goal is to build a secure, maintainable and commercially viable Software Architecture Intelligence Platform.

**Build ArchMind as a product that professional engineering teams can trust.**
