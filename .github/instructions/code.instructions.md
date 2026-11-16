---
applyTo: "**/*.ts,**/*.tsx,**/*.mts"
---

# TypeScript

- Strict mode. No `any`; use `unknown` and narrow.
- Explicit types on public interfaces. Prefer readonly and immutable data.
- Do not swallow exceptions or catch and ignore. Preserve error context. Separate expected business errors from infrastructure failures.
- Never expose internal error details to API consumers.
- Use async/await. Bound parallelism. Set timeouts on external calls. Make retried operations idempotent.
- No dead code. Follow the existing ESLint and Prettier config.
