# Testing Strategy

Testing is mandatory.

## Unit tests

Test:

- Domain rules.
- Application services.
- Dependency extraction.
- Architecture graph operations.
- Governance rules.
- Agent output validation.

## Integration tests

Test:

- Database operations.
- Repository integration.
- Analysis pipelines.
- Module interactions.
- Agent tool execution.

## End-to-end tests

Test important user journeys:

- Registration.
- Workspace creation.
- GitHub connection.
- Repository selection.
- Repository analysis.
- Architecture visualisation.
- Architectural question and answer.

## Testing rules

- Tests must be deterministic.
- Avoid unnecessary external service dependencies.
- Mock external integrations where appropriate.
- Use realistic fixtures.
- Do not make production LLM calls in ordinary unit tests.
- Test failure scenarios as well as successful execution.
