---
applyTo: "packages/domain/**,packages/database/**,**/*.prisma"
---

# Domain model and database

- PostgreSQL is the system of record, accessed through Prisma. Do not propose another ORM. Schema changes require migrations. Add indexes for known query patterns.
- Neon is under consideration for hosting (ADR-0011) and is not yet approved. Keep Neon-specific features out of application code. If it is adopted, use the direct connection for Prisma migrations.
- Every workspace-owned resource has an explicit workspace ownership path. Enforce workspace authorisation on the server.
- Architecture graph is relational. No graph database without demonstrated need.
- A dependency from component A to component B means A depends on B.
- Both ends of a dependency must belong to the same architecture snapshot.
