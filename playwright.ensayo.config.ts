import { defineConfig, devices } from "@playwright/test";

/**
 * Ensayo de implementación (O10-01): fuera de la suite E2E normal porque tarda
 * minutos por tienda. Mismos requisitos que `playwright.config.ts`.
 */
export default defineConfig({
  testDir: "tests/ensayo",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "es-MX",
    // Sin tope por acción, un paso que no encuentra su campo esperaría hasta el final.
    actionTimeout: 30_000,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
