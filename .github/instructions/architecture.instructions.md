# Architectural Principles

## Modular Monolith

ArchMind should initially be implemented as a modular monolith.

The system must have clearly defined domain boundaries and responsibilities, but does not need to be distributed into independent microservices.

Avoid premature microservice architecture.

Modules should communicate through explicit interfaces and contracts.

## Separation of Concerns

Maintain clear separation between:

- Presentation.
- Application orchestration.
- Domain logic.
- Infrastructure.
- External integrations.

Domain logic must not depend directly on infrastructure implementations.

Business rules should not be implemented in controllers, React components or database access layers.

## Domain-Driven Design

Use domain-driven design principles where they add value.

Organise the backend around bounded contexts:

- Identity and Access.
- Workspace Management.
- Repository Integration.
- Code Intelligence.
- Architecture Model.
- Governance.
- AI Intelligence.
- Analysis and Findings.
- Billing and Usage.

Keep domain terminology consistent across the application.

## Dependency Direction

Dependencies must point towards stable abstractions.

- Domain modules should remain independent of external infrastructure.
- Application services coordinate domain operations.
- Infrastructure implements interfaces defined by the application or domain where appropriate.
- Presentation layers communicate through application interfaces.
- Cross-module access must use explicit contracts.

Avoid circular dependencies between modules.

## Prefer Simplicity

Use the simplest solution that satisfies the requirements.

Avoid:

- Premature abstraction.
- Unnecessary design patterns.
- Overengineering.
- Unnecessary microservices.
- Duplicate functionality.
- Excessive configuration.
- Generic frameworks built for hypothetical future requirements.

Do not sacrifice maintainability for unnecessary flexibility.
