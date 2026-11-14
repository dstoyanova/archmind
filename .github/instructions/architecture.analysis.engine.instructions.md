# Architecture Analysis Engine

The code analysis engine is a core product capability.

## Fundamental principle

Deterministic code analysis must establish facts before AI agents interpret them.

Do not use LLMs to determine basic facts that can be extracted reliably through static analysis.

Examples:

- Imports.
- Module dependencies.
- File relationships.
- Symbol declarations.
- Dependency direction.
- Circular dependencies.

## Analysis requirements

- Make parsing deterministic.
- Support incremental development.
- Handle malformed or unsupported source files gracefully.
- Exclude generated files where appropriate.
- Track parser and analysis engine versions.
- Preserve source references.
- Make analysis repeatable.
- Make analysis workflows safe to retry.

## Architecture snapshots

Architecture snapshots must be immutable once published.

Every snapshot must reference:

- Repository.
- Commit SHA.
- Analysis version.
- Parser version.
- Creation timestamp.

Do not modify previous snapshots when analysing a newer commit.
