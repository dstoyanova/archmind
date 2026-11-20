import { env } from "node:process";
import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "@playwright/test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const snapshotDirectory = fileURLToPath(new URL(".tmp/explorer-snapshots/", import.meta.url));
const apiOrigin = "http://127.0.0.1:3911";
const webOrigin = "http://127.0.0.1:3910";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  use: { baseURL: webOrigin, viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  webServer: [
    {
      cwd: root,
      command:
        "pnpm exec tsx apps/api/tests/generate-explorer-fixtures.ts && pnpm --filter @archmind/api start",
      env: { ARCHMIND_SNAPSHOT_DIR: snapshotDirectory, PORT: "3911" },
      url: `${apiOrigin}/api/docs`,
      reuseExistingServer: false
    },
    {
      cwd: root,
      command: "pnpm --filter @archmind/web start --port 3910",
      env: { ARCHMIND_API_ORIGIN: apiOrigin, NEXT_TELEMETRY_DISABLED: "1" },
      url: webOrigin,
      reuseExistingServer: false
    }
  ],
  reporter: env.CI ? "github" : "list"
});
