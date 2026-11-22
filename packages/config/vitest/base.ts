import { defineConfig } from "vitest/config";

const baseVitestConfig = defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/fixtures/**"]
  }
});

export default baseVitestConfig;
