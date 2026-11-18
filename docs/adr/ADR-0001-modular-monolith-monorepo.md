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

## Addendum (2026-11-17): analysis pipeline package and engine dependency on domain

Approved after the M1 code review.

- **`packages/analysis-pipeline`** composes `code-analysis` and `architecture-engine` into `analyzeRepository`. The CLI uses it in M1 and the M4 worker reuses it, so both produce identical snapshots. The engines stay independent of each other, and apps and the pipeline are the only places that compose them. The pipeline may depend on the two engines, `contracts` and `domain`.
- **Engines may depend on `domain`** in addition to `contracts`. The graph functions that the plan places in `domain` (cycle detection, hierarchy projection) and the shared ordering and canonical JSON helpers are consumed by the engines directly. `domain` still depends on no internal package.
- The ESLint import restrictions in `packages/config/eslint/archmind.mjs` enforce both rules.

## Addendum (2026-11-18): local explorer development and build

Approved for M2. Run `apps/api` in development with `tsx watch`. The API uses explicit NestJS injection tokens and passes the Zod DTO to each validation pipe, so it does not rely on emitted decorator metadata. Use esbuild for the production API bundle, including workspace TypeScript source and keeping third-party runtime packages external. Run the bundle with Node.js. Type-check separately with `tsc --noEmit`.

When `apps/web` is introduced, use the native Next.js development and build commands and shadcn/ui components. Turborepo runs app `dev` tasks without caching and collects `dist` and `.next` build outputs.
