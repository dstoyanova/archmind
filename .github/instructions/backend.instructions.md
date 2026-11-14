# Backend Development Guidelines

The backend uses NestJS.

## Module structure

Backend modules should encapsulate their own responsibilities.

A typical module may contain:

```text
module-name/
├── application/
├── domain/
├── infrastructure/
├── presentation/
└── module-name.module.ts
```

Only introduce these subdirectories where they improve clarity.

## Controllers

Controllers should:

- Handle HTTP requests.
- Validate incoming data.
- Delegate to application services.
- Return appropriate responses.

Controllers should not contain business logic.

## Application services

Application services coordinate use cases and domain operations.

They should not become large classes containing unrelated business functionality.

## Data access

- Keep database access behind appropriate repositories or data access services.
- Do not expose Prisma models as public domain contracts.
- Use transactions where consistency requires them.
- Avoid N+1 query patterns.
- Consider query performance when traversing architecture graphs.

## API design

- Use REST conventions.
- Use consistent resource naming.
- Validate all incoming requests.
- Document endpoints through OpenAPI.
- Use consistent error responses.
- Apply pagination to potentially large collections.
