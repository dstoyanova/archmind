# Explorer rendering benchmark

The Playwright fixture generates a snapshot with 300 components and 3,000 internal dependencies. The initial production projection has 299 visible components; expanding `component-0` shows the last child. The test verifies that the expanded graph renders all 3,000 edges.

Run from the repository root:

```bash
pnpm build --filter=@archmind/api --filter=@archmind/web
pnpm --filter @archmind/web exec playwright install chromium
ARCHMIND_ENFORCE_RENDER_BUDGET=1 pnpm --filter @archmind/web test:e2e --repeat-each=3
```

Each timing starts just before the click and ends two animation frames after the expected graph is present and no longer busy. The first render is measured from selecting the performance snapshot in the loaded explorer, not from cold application startup. Requests go to the real local API, and Playwright runs the production builds.

On an Apple M4 developer laptop (headless Chromium 159, 1440 × 900 viewport), all three runs met the provisional budgets:

| Interaction  | Run 1  | Run 2  | Run 3  | Budget   |
| ------------ | ------ | ------ | ------ | -------- |
| First render | 454 ms | 423 ms | 414 ms | < 2 s    |
| Expand       | 399 ms | 398 ms | 398 ms | < 500 ms |
| Collapse     | 391 ms | 399 ms | 396 ms | < 500 ms |

CI checks that the graph renders and logs the timings. Set `ARCHMIND_ENFORCE_RENDER_BUDGET=1` to enforce the laptop budgets on a comparable machine.

The M3.5 benchmark also selects a governance evaluation with 299 findings before measuring expand and collapse. It verifies 298 badges while collapsed (two findings share a visible ancestor) and 299 after expansion. With budgets enforced, the first render took 390 ms, expand with highlights took 418 ms, and collapse with highlights took 366 ms.

## Layout decision

[E3 of the M2 code review](../code-reviews/m2-code-review.md) asked whether the explorer should keep ELK `box` packing. The screenshots are in [m2-layout-screenshots](./m2-layout-screenshots), captured in headless Chromium at 1440 × 900 with default filters, for Vitest and Changesets at the M2.7 revisions. The `box` screenshots were taken with the hiding of components without source files already applied, so Vitest shows 23 components rather than the 43 of the M2.7 run.

| Repository | View     | `box` (edges ignored)                                             | `layered` (edges passed to ELK)                                       |
| ---------- | -------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- |
| Vitest     | Default  | [screenshot](./m2-layout-screenshots/vitest-box-default.png)      | [screenshot](./m2-layout-screenshots/vitest-layered-default.png)      |
| Vitest     | Expanded | [screenshot](./m2-layout-screenshots/vitest-box-expanded.png)     | [screenshot](./m2-layout-screenshots/vitest-layered-expanded.png)     |
| Changesets | Default  | [screenshot](./m2-layout-screenshots/changesets-box-default.png)  | [screenshot](./m2-layout-screenshots/changesets-layered-default.png)  |
| Changesets | Expanded | [screenshot](./m2-layout-screenshots/changesets-box-expanded.png) | [screenshot](./m2-layout-screenshots/changesets-layered-expanded.png) |

**Finding.** With `box`, nodes are packed by size, so dependencies are straight lines across the whole canvas, often through other nodes. Direction cannot be read: in Vitest, 168 edges cross a 90-package external grid, and in Changesets the expanded `cli` children are in no order.

**Decision.** Replace `box` with the ELK `layered` algorithm (direction right, `INCLUDE_CHILDREN` hierarchy handling) when the projection has at most 500 internal edges. Layers now follow dependency direction, so Changesets' `release-utils` and `apply-release-plan` sit left of the packages they use, and an expanded `cli` stays one group around its children. External packages are not passed to ELK, because they only receive edges and the layered algorithm stacks such sinks in one tall column. They are placed in a grid beside the layout instead.

**Why a limit.** On the 300-component benchmark fixture, the layered layout takes about 160 ms with 300 edges, 260 ms with 600 edges, 1.1 s with 1,500 and 7.3 s with all 2,981 (Node, layout only). Layered layout cost grows steeply with edge count, so denser projections keep `box` and the 2 s and 500 ms budgets still hold.

| Interaction (headless Chromium, Apple M4) | Vitest default | Changesets default |
| ----------------------------------------- | -------------: | -----------------: |
| First render after selecting the snapshot |  100 to 200 ms |       90 to 280 ms |
| Expand `vitest` / `cli`                   |  110 to 120 ms |       90 to 100 ms |
| Collapse                                  |         ~90 ms |       90 to 115 ms |

These include a 50 ms wait for the busy state to start. The 300-component fixture above is unchanged because it exceeds the limit, and was re-run with `ARCHMIND_ENFORCE_RENDER_BUDGET=1 --repeat-each=3` after the change: first render 377 to 422 ms, expand about 382 ms, collapse 397 to 411 ms. A Playwright test checks that expanded children stay inside their parent in the layered layout.

**Limitation.** Dense projections of more than 500 internal edges still have the `box` problems. Collapsing components or turning off internal dependencies reduces the edge count.
