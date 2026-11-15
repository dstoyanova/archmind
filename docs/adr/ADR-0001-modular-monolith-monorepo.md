# ADR-0001: Modular monolith with pnpm + Turborepo monorepo

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

ArchMind needs explicit architectural boundaries from day one, but the MVP must avoid the operational overhead of distributed services.
We also need shared TypeScript, linting and testing standards across future apps and packages.

## Problem

We must choose a repository and runtime architecture that:

1. Preserves clear module boundaries and dependency direction.
2. Enables incremental delivery of CLI, API, web and worker units.
3. Minimises early platform and operations complexity.

## Considered alternatives

1. **Modular monolith in a monorepo (pnpm + Turborepo).**
2. Microservices from the start with separate repositories.
3. Single-package repository without workspace boundaries.

## Decision

Adopt a **modular monolith** in a **pnpm workspace** managed by **Turborepo**.

- Apps (`apps/*`) compose domain and engine packages.
- Packages (`packages/*`) expose public entry points and follow explicit dependency rules.
- Shared strict configuration lives in `packages/config`.

## Consequences

### Positive

- Explicit boundaries without distributed-system overhead.
- Shared toolchain and consistent quality gates.
- Faster iteration for MVP milestones.

### Negative

- Requires active enforcement of package dependency rules.
- Future extraction into services still requires intentional boundary hardening.

