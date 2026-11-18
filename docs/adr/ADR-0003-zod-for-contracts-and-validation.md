# ADR-0003: zod for contracts and validation

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

ArchMind needs consistent, executable contracts across CLI, API, worker and web while the platform is still evolving quickly.
Validation must stay close to contract definitions so snapshots and configuration are validated in one place.

## Problem

We need a validation and schema approach that:

1. Supports runtime validation and inferred TypeScript types from the same source.
2. Works in shared packages and can be reused by all apps.
3. Scales to external contracts such as snapshot documents and `archmind.config.json`.

## Considered alternatives

1. **zod schemas shared from `packages/contracts`.**
2. NestJS DTO classes and class-validator for all validation.
3. JSON Schema only, with separate TypeScript types.

## Decision

Adopt **zod** as the contract and runtime validation library.

- `packages/contracts` owns schemas for external contracts.
- `packages/domain` owns pure domain invariants and graph behavior.
- Snapshot validation combines structural schema checks with domain invariant checks.

## Consequences

### Positive

- One source for runtime validation and TypeScript types.
- Shared schemas can be reused across CLI, API, worker and web.
- Contract changes are explicit and testable.

### Negative

- Requires discipline to avoid duplicating business logic in schemas.
- Team must align on zod patterns for error formatting and evolution.

## Addendum (2026-11-18): explorer request validation and OpenAPI

Approved for M2. Use `nestjs-zod` 5.x with NestJS 10 or 11 for request validation in `apps/api` (M2.3). Use `@asteasolutions/zod-to-openapi` 7.x to generate OpenAPI from the shared Zod schemas in `packages/contracts`. Both support the existing Zod 3.25 dependency. The contracts package does not depend on NestJS.

The generated OpenAPI document describes the explorer routes and their request, response and error schemas. The API will serve that same document at `/api/docs`; Nest DTOs and decorators are not a second source of OpenAPI schemas. The API will map validation failures to the shared error envelope.
