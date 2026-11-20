import { env, stdout } from "node:process";

import { expect, test } from "@playwright/test";

test("follows the system theme by default and remembers explicit overrides", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const theme = page.getByRole("combobox", { name: "Theme" });
  const body = page.locator("body");
  const graph = page.getByRole("region", { name: "Architecture graph" }).locator(".react-flow");
  await expect(theme).toHaveText("System");
  await expect(body).toHaveCSS("background-color", "rgb(245, 247, 251)");
  await expect(graph).toHaveClass(/\blight\b/);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(body).toHaveCSS("background-color", "rgb(11, 17, 32)");
  await expect(graph).toHaveClass(/\bdark\b/);

  await theme.click();
  await page.getByRole("option", { name: "Light", exact: true }).click();
  await page.reload();
  await expect(theme).toHaveText("Light");
  await expect(body).toHaveCSS("background-color", "rgb(245, 247, 251)");
  await expect(graph).toHaveClass(/\blight\b/);

  await page.emulateMedia({ colorScheme: "light" });
  await theme.click();
  await page.getByRole("option", { name: "Dark", exact: true }).click();
  await expect(body).toHaveCSS("background-color", "rgb(11, 17, 32)");
  await expect(graph).toHaveClass(/\bdark\b/);

  await theme.click();
  await page.getByRole("option", { name: "System", exact: true }).click();
  await expect(body).toHaveCSS("background-color", "rgb(245, 247, 251)");
  await expect(graph).toHaveClass(/\blight\b/);
});

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

test("opens overview, inspects dependency evidence, and drills into the file graph", async ({
  page
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Snapshot overview" }).click();
  await expect(page.getByText("Engine version", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Diagnostics/ })).toBeVisible();
  await page.getByRole("button", { name: "Snapshot overview" }).click();

  const graph = page.getByRole("region", { name: "Architecture graph" });
  await graph.getByRole("button", { name: "Expand lib" }).click();
  await expect(graph.getByRole("button", { name: "Details for internal" })).toBeVisible();
  await page.getByRole("button", { name: "Show component list" }).click();
  await page
    .getByRole("region", { name: "Component graph list" })
    .getByRole("button", { name: "app details" })
    .press("Enter");
  const panel = page.getByRole("complementary", { name: "Component details" });
  await expect(panel.getByText(/Production graph at this component/)).toBeVisible();
  await panel
    .getByRole("button", { name: /View evidence: app to/ })
    .first()
    .click();
  const evidence = panel.getByRole("region", { name: "Dependency evidence" });
  await expect(evidence.getByText(/packages\/app\/src\/main\.ts:\d+/).first()).toBeVisible();
  await expect(evidence.getByText(/static · source/).first()).toBeVisible();

  await panel.getByRole("button", { name: "Open file graph" }).click();
  const files = page.getByRole("region", { name: "File graph", exact: true });
  await expect(files.getByText("File graph: app")).toBeVisible();
  await expect(
    files.locator(".react-flow__node").filter({ hasText: "packages/app/src/main.ts" })
  ).toBeVisible();
  await files.getByText("File graph list", { exact: true }).click();
  await expect(
    files
      .getByRole("list", { name: "File imports" })
      .getByText(/packages\/app\/src\/main\.ts/)
      .first()
  ).toBeVisible();
  await files.getByRole("button", { name: "Back to component graph" }).click();
  await expect(page.getByRole("region", { name: "Component graph list" })).toBeVisible();
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
