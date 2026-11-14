# Database and Domain Model Guidelines

PostgreSQL is the system of record.

Use Prisma for database access.

## Domain principles

- Preserve clear ownership of entities.
- Maintain tenant isolation.
- Use explicit relationships.
- Avoid unnecessary denormalisation.
- Use migrations for schema changes.
- Add indexes based on query patterns.
- Use transactions where necessary.

## Multi-tenancy

Every workspace-owned resource must have an explicit workspace ownership path.

Always enforce workspace authorisation on the server.

Never rely solely on frontend filtering to provide tenant isolation.

## Architecture graph

Initially store architecture components and dependencies relationally.

A dependency from component A to component B means A depends on B.

Every dependency must reference components belonging to the same architecture snapshot.

Do not introduce a graph database without demonstrated technical need.
