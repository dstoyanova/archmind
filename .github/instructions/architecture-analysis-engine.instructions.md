---
applyTo: "packages/code-analysis/**,packages/architecture-engine/**"
---

# Analysis engine

- Extract facts (imports, module dependencies, file relationships, symbols, dependency direction, cycles) with static analysis. Never use an LLM for them.
- Parsing must be deterministic and repeatable. Identical input yields identical output.
- Malformed or unsupported files must not abort analysis. Report them as diagnostics.
- Exclude generated files.
- Keep source references (file and location) on every extracted fact.
- Analysis workflows must be safe to retry.

## Snapshots

Snapshots are immutable once published ([ADR-0004](../../docs/adr/ADR-0004-immutable-versioned-snapshot-and-content-hash.md)). Each references repository, commit SHA, analysis version, parser version and creation timestamp. Analysing a newer commit creates a new snapshot; never modify an existing one.
