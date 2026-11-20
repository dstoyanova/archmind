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
