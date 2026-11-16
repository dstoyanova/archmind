# ArchMind

AI-powered software architecture intelligence platform: analyses source code, dependencies and Git history into an immutable architecture model, then uses AI agents to find risks and answer questions.

Principles: evidence before opinions; deterministic analysis before AI interpretation; explainable output; human approval for consequential decisions; security by design; incremental delivery.

## Current state

Implemented: `packages/domain`, `packages/contracts`, `packages/code-analysis`, `packages/config`. Delivery order is analysis-first and CLI-first ([ADR-0002](../docs/adr/ADR-0002-analysis-first-delivery-order-and-cli.md)).

Planned, not yet present: `apps/*`, NestJS, Next.js, Prisma/PostgreSQL, pg-boss (Temporal later), LangGraph.js. Do not create packages, directories or dependencies for them without an implementation need.

Read before architectural work: [ARCHITECTURE.md](../docs/ARCHITECTURE.md), [ROADMAP.md](../docs/ROADMAP.md), [BACKLOG.md](../docs/BACKLOG.md), [MVP plan](../docs/plans/mvp-implementation-plan.md), `docs/adr/`.

## Technology decisions to raise

Decided: **shadcn/ui** for UI components; **Prisma** stays as the ORM (Drizzle was rejected, do not re-propose it).

Pending: **Clerk** for authentication (email and password, plus GitHub sign-in) and **Neon** for managed Postgres. Do not implement either until the human approves the ADR.

When you start work that touches one of these, say so up front, summarise the open questions and ask for approval before writing code:

| Starting work on | Raise |
| --- | --- |
| `apps/web`, any UI (M2.3, M3.5, M4.6) | Use shadcn/ui components. Custom components only where it has no equivalent. |
| Authentication, sessions, users, workspace membership (M5.1 to M5.3) | Clerk. Resolve the open questions in the plan's §4.13, then approve ADR-0009. |
| GitHub App, per-user repository access (M5.1, M5.4) | Clerk sign-in does not prove repository access. See §4.13. |
| Hosting, staging, managed Postgres, `packages/database` deployment (M5.5) | Neon. Approve ADR-0011. Direct connection for Prisma migrations and pg-boss. |

## Commands

Package manager is pnpm; tasks run through Turborepo.

- `pnpm lint`, `pnpm typecheck`, `pnpm test` (all packages)
- Single package: `pnpm --filter @archmind/<package> test`

Run lint, typecheck and relevant tests before finishing. Never claim they passed unless you ran them.

## Architecture rules

- Modular monolith ([ADR-0001](../docs/adr/ADR-0001-modular-monolith-monorepo.md)). No microservices.
- Package dependency direction: `domain` ← `contracts` ← `code-analysis`. `domain` imports no other workspace package. No circular dependencies.
- Contracts and validation use zod ([ADR-0003](../docs/adr/ADR-0003-zod-for-contracts-and-validation.md)).
- Domain logic must not depend on infrastructure. Business rules do not belong in controllers, React components or data access.
- Cross-module access goes through explicit contracts.
- Use the simplest solution. No speculative abstractions.

## Ask for human approval before

- Changing architectural boundaries or package dependency direction.
- Adding major dependencies or infrastructure services.
- Changing authentication, authorisation or tenant isolation.
- Changing database ownership or core domain models.
- Destructive operations.

## Other rules

- Add a new ADR for significant decisions. Supersede obsolete ADRs; do not rewrite them.
- Implement only the requested scope. Add or update tests. Update affected docs.
- Ask for clarification when ambiguity materially affects the implementation.
- Summarise changes and known limitations at the end.
