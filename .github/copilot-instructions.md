# ArchMind

AI-powered software architecture intelligence platform: analyses source code, dependencies and Git history into an immutable architecture model, then uses AI agents to find risks and answer questions.

Principles: evidence before opinions; deterministic analysis before AI interpretation; explainable output; human approval for consequential decisions; security by design; incremental delivery.

## Current state

Implemented: `packages/domain`, `packages/contracts`, `packages/code-analysis`, `packages/config`. Delivery order is analysis-first and CLI-first ([ADR-0002](../docs/adr/ADR-0002-analysis-first-delivery-order-and-cli.md)).

Planned, not yet present: `apps/*`, NestJS, Next.js, Prisma/PostgreSQL, Temporal, LangGraph.js. Do not create packages, directories or dependencies for them without an implementation need.

Read before architectural work: [ARCHITECTURE.md](../docs/ARCHITECTURE.md), [ROADMAP.md](../docs/ROADMAP.md), `docs/adr/`.

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
