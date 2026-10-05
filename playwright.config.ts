import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra la app compilada y el stack local (A-08: Chromium preinstalado en
 * PLAYWRIGHT_BROWSERS_PATH). Requisitos: `pnpm stack up` y la app en
 * http://localhost:3000 (`pnpm build && pnpm start -H localhost -p 3000`).
 */
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "es-MX",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
