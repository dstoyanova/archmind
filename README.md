# ArchMind

**Make software architecture observable, understandable and continuously improvable.**

ArchMind is an architecture intelligence platform that helps engineering teams understand their software systems, identify architectural risks and make better design decisions.

## Vision

Give engineering teams a continuously updated understanding of their software architecture — from code structure and dependencies to architectural health and governance.

## Core capabilities

- **System Explorer** — Explore components, dependencies and system structure.
- **Architecture Governance** — Define and evaluate architectural rules and principles.
- **Change Impact Analysis** — Understand the architectural impact of code changes.
- **Architecture Health** — Identify coupling, complexity and architectural risks.
- **AI Architecture Assistant** — Ask questions, explore trade-offs and get evidence-based recommendations.

## Initial MVP

The first version focuses on TypeScript repositories:

1. Connect a GitHub repository.
2. Analyse its source code.
3. Build an architecture model and dependency graph.
4. Visualise the system structure.
5. Identify basic architectural risks.
6. Ask questions and receive evidence-backed answers.

## Technology

- TypeScript
- Next.js and React
- NestJS
- PostgreSQL and Prisma
- TypeScript Compiler API
- React Flow
- LangGraph.js
- pnpm workspaces and Turborepo

## Project status

Early development. The initial focus is building the code analysis engine and architecture model.

## Development commands

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

## CLI analysis (M1.9)

See [docs/development/cli-analyze.md](/Users/desislava/Documents/repos/archmind/docs/development/cli-analyze.md) for full setup, command options and examples.
