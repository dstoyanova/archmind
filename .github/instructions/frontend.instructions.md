---
applyTo: "apps/web/**"
---

# Frontend (Next.js, React)

- Functional components. Server components by default; client components only for interactivity.
- Use shadcn/ui (Radix and Tailwind) for UI components. Add them with the shadcn CLI into `apps/web`. Build a custom component only when shadcn/ui has no equivalent, such as React Flow nodes.
- Separate data fetching from presentation.
- Organise by feature (workspaces, repositories, architecture explorer, findings, conversations, settings), not one shared components directory.
- Every view has useful empty, loading and error states. Interactions are accessible and layouts responsive.
- The architecture graph (React Flow) must stay interactive and performant on large graphs.
- Show actionable information; no decorative dashboards.
