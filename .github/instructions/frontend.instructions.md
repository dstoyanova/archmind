# Frontend Development Guidelines

The frontend uses Next.js and React.

## General

- Prefer functional React components.
- Use hooks appropriately.
- Keep components focused.
- Separate data fetching from presentation where practical.
- Avoid unnecessary client-side rendering.
- Use server components where appropriate.
- Use client components only when interactivity requires them.

## UI architecture

Organise frontend functionality around product features.

Examples:

- Workspaces.
- Repositories.
- Architecture Explorer.
- Findings.
- Conversations.
- Settings.

Avoid placing all functionality in a single shared components directory.

## UX principles

ArchMind should feel like a professional engineering product.

Prioritise:

- Clear information hierarchy.
- Data density without clutter.
- Useful empty states.
- Clear loading and error states.
- Consistent navigation.
- Accessible interactions.
- Responsive layouts.

The architecture graph should be interactive, performant and easy to explore.

Avoid decorative dashboards that do not communicate actionable information.
