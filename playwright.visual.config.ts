import { defineConfig, devices } from "@playwright/test";

/**
 * Capturas de referencia (misión de mejoras 2026-11): portada, listado, ficha,
 * carrito, checkout y panel a 375 y 1280 px, para comparar antes y después de
 * cada cambio. No forma parte de `pnpm test:e2e`. Requisitos: stack, app y
 * `pnpm demo:seed`. Uso: `VISUAL_OUT=docs/audit/referencia pnpm exec playwright
 * test -c playwright.visual.config.ts`.
 */
export default defineConfig({
  testDir: "tests/visual",
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
