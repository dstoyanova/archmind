---
applyTo: "apps/api/**,apps/worker/**"
---

# Backend (NestJS)

- Organise by bounded context: Identity and Access, Workspace Management, Repository Integration, Code Intelligence, Architecture Model, Governance, AI Intelligence, Analysis and Findings, Billing and Usage.
- Module layout where it adds clarity: `application/`, `domain/`, `infrastructure/`, `presentation/`, `<name>.module.ts`.
- Controllers only handle HTTP, validate input and delegate to application services. No business logic.
- Application services coordinate one use case area. Split them when they grow unrelated responsibilities.
- Keep Prisma behind repositories. Never expose Prisma models as public contracts.
- Use transactions where consistency requires them. Avoid N+1 queries, especially in graph traversal.
- REST with consistent resource naming, OpenAPI docs, a consistent error format and pagination on large collections.
