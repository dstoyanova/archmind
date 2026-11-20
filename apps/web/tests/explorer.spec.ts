import { env, stdout } from "node:process";

import { expect, test } from "@playwright/test";

test("expands and searches nested components and reports invalid snapshots", async ({ page }) => {
  await page.goto("/");
  const graph = page.getByRole("region", { name: "Architecture graph" });
  const expand = graph.getByRole("button", { name: "Expand lib" });
  await expand.click();
  await expect(graph.getByRole("button", { name: "Collapse lib" })).toBeVisible();
  await expect(
    graph.getByTestId("component-node").filter({ hasText: "packages/lib/src/internal" })
  ).toBeVisible();
  await graph.getByRole("button", { name: "Collapse lib" }).click();
  const search = page.getByRole("searchbox", { name: "Find a component" });
  await search.fill("packages/lib/src/internal");
  await page.getByRole("button", { name: /internal \/ packages\/lib\/src\/internal/ }).click();
  await expect(graph.locator(".focused-node")).toContainText("internal");

  await page.getByRole("checkbox", { name: "Internal dependencies" }).click();
  await expect(graph.locator(".react-flow__edge.internal")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Snapshot" }).click();
  await page.getByRole("option", { name: "invalid.json (invalid)" }).click();
  await expect(page.getByText("Snapshot is not valid JSON.")).toBeVisible();
});

test("measures first paint and expand/collapse for the 300-component fixture", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Snapshot" }).click();
  const select = page.getByRole("option", { name: "performance.json" });
  const graph = page.getByRole("region", { name: "Architecture graph" });
  const measure = async (
    label: string,
    action: () => Promise<void>,
    count: number,
    budget: number
  ) => {
    const start = await page.evaluate(() => globalThis.performance.now());
    await action();
    await page.waitForFunction((expected) => {
      const canvas = globalThis.document.querySelector('[aria-label="Architecture graph"]');
      return (
        canvas?.getAttribute("aria-busy") === "false" &&
        canvas.querySelectorAll('[data-testid="component-node"]').length === expected
      );
    }, count);
    const elapsed = await page.evaluate(async (started) => {
      await new Promise<void>((resolve) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(() => resolve()))
      );
      return globalThis.performance.now() - started;
    }, start);
    stdout.write(`${label}: ${elapsed.toFixed(1)} ms (budget ${budget} ms)\n`);
    if (env.ARCHMIND_ENFORCE_RENDER_BUDGET === "1") expect(elapsed, label).toBeLessThan(budget);
  };
  await measure("First render", () => select.click(), 299, 2000);
  await measure(
    "Expand",
    () => graph.getByRole("button", { name: "Expand component-0", exact: true }).click(),
    300,
    500
  );
  await expect(graph.locator(".react-flow__edge.runtime-cycle")).toHaveCount(3000);
  await measure(
    "Collapse",
    () => graph.getByRole("button", { name: "Collapse component-0", exact: true }).click(),
    299,
    500
  );
});
