# TypeScript Coding Standards

## General

- Use strict TypeScript.
- Avoid `any`.
- Prefer explicit types for public interfaces.
- Use interfaces or types consistently.
- Prefer immutable data structures where practical.
- Keep functions focused and reasonably small.
- Avoid deeply nested conditional logic.
- Use descriptive names.
- Avoid unnecessary abbreviations.

## Error handling

- Use explicit error handling.
- Do not silently swallow exceptions.
- Avoid generic catch-and-ignore patterns.
- Distinguish expected business errors from unexpected infrastructure failures.
- Preserve useful error context.
- Never expose sensitive implementation details to API consumers.

## Asynchronous operations

- Use async/await.
- Handle promise failures explicitly.
- Avoid unbounded parallel operations.
- Apply timeouts and retries where appropriate.
- Ensure background operations are safe to retry.

## Code quality

- Follow existing formatting and linting rules.
- Avoid duplicated logic.
- Avoid unnecessary dependencies.
- Do not introduce dead code.
- Keep functions and modules cohesive.
