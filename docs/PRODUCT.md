# ArchMind — Product Overview

## Problem

As software systems grow, understanding their architecture becomes increasingly difficult.

Documentation becomes outdated, dependencies become harder to track, architectural rules are inconsistently applied, and technical debt accumulates.

Engineering teams need a reliable and continuously updated view of their architecture.

## Product vision

ArchMind turns source code into an evolving architecture model and provides intelligence to help teams understand, govern and improve their systems.

## Target users

- Software Architects
- Principal and Staff Engineers
- Engineering Managers
- Heads of Engineering

Initially targeting engineering teams with established codebases and multiple components or services.

## Core capabilities

1. **System Explorer:** Understand components, dependencies, APIs and system structure.
2. **Governance:** Define architectural principles and automatically detect violations.
3. **Change Impact:** Identify affected components and architectural risks.
4. **Architecture Health:** Track coupling, complexity, violations and trends.
5. **AI Assistant:** Explore architecture, ask questions and receive recommendations.

## MVP scope

The MVP should answer:

**"What does my software architecture look like, and what should I be concerned about?"**

It will include:

- GitHub integration and repository selection.
- TypeScript source code analysis.
- Dependency extraction and architecture modelling.
- Interactive architecture visualisation.
- Basic deterministic architecture rules.
- Findings with supporting evidence.
- An AI assistant that answers questions using the architecture model.

## Out of scope initially

- Autonomous code modifications.
- Runtime monitoring and infrastructure discovery.
- Multiple programming languages.
- Automated refactoring.
- Complex enterprise governance workflows.

## Product principles

- Evidence over assumptions.
- Architecture intelligence over simple code search.
- Deterministic analysis wherever possible.
- AI as an assistant, not an unquestioned authority.
- Continuous architectural understanding over one-time analysis.
