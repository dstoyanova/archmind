---
applyTo: "packages/domain/**,packages/database/**,**/*.prisma"
---

# Domain model and database

- PostgreSQL is the system of record, accessed through Prisma. Schema changes require migrations. Add indexes for known query patterns.
- Every workspace-owned resource has an explicit workspace ownership path. Enforce workspace authorisation on the server.
- Architecture graph is relational. No graph database without demonstrated need.
- A dependency from component A to component B means A depends on B.
- Both ends of a dependency must belong to the same architecture snapshot.
