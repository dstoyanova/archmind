# ADR-0002: Analysis-first delivery order and CLI-first execution

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

ArchMind's product value depends on deterministic architecture analysis that AI and governance features can trust.
The highest technical risk is analysis correctness and repeatability, not hosting concerns.

## Problem

We must choose a delivery sequence and first deployable unit that:

1. Validates deterministic analysis early.
2. Produces demoable value at each milestone.
3. Avoids premature investment in platform capabilities before core value is proven.

## Considered alternatives

1. **Analysis-first with local CLI first.**
2. Build hosted multi-user platform first.
3. Build AI assistant first.

## Decision

Deliver milestones in this order:

1. Local analysis CLI.
2. Local explorer.
3. Local governance.
4. Persistence and background processing.
5. GitHub, teams and staging.
6. AI assistant.
7. Beta hardening.

Create `apps/cli` as the first app so deterministic analysis and governance checks can run locally and in CI.

## Consequences

### Positive

- Proves the core analysis value before platform expansion.
- Provides fast local and CI feedback loops.
- Ensures AI features are built on deterministic facts.

### Negative

- User-facing hosted workflows arrive later in the roadmap.
- Temporary local-only constraints in M1–M3.
