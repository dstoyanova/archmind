---
applyTo: "**/*.test.ts,**/*.test.tsx,tests/**"
---

# Testing (Vitest, Playwright)

- Unit tests sit next to the source as `*.test.ts`. Integration, e2e and shared fixtures go under `tests/`.
- Tests must be deterministic. Mock external services (GitHub, LLMs, databases) in unit tests. Never make real LLM calls.
- Use realistic fixtures.
- Cover failure paths, not only success: malformed input, unsupported files, invalid contracts.
- Cover domain rules, dependency extraction, graph operations, governance rules, agent output validation and analysis pipelines.
- E2E (Playwright) covers key journeys only: registration, workspace creation, GitHub connection, repository analysis, architecture visualisation, Q&A.
