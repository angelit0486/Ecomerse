import { expect, test } from "@playwright/test";

import {
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/**
 * Ayuda del panel (auditoría global, paso 22; interruptor panel_help): apagada no
 * aparece; la dueña la enciende en Ajustes → Funciones; las guías se abren y su
 * botón lleva a la pantalla donde se hace la tarea. Celular sin desbordes.
 */
const run = uniq();
const ownerEmail = `ayuda-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`ay${run}`, await createAuthUser(ownerEmail));
});

test("ayuda: apagada no aparece; encendida, guías paso a paso que llevan a su pantalla", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  const base = `/admin/${tenant.handle}`;
  await page.goto(base);
  await expect(page.getByRole("link", { name: "Ayuda", exact: true })).toHaveCount(0);
  expect((await page.goto(`${base}/ayuda`))?.status()).toBe(404);

  await page.goto(`${base}/ajustes/funciones`);
  await page
    .getByRole("form", { name: "Ayuda en el panel" })
    .getByRole("button", { name: "Encender ayuda en el panel" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Ayuda en el panel: encendida." }),
  ).toBeVisible();

  await page.goto(base);
  await page.getByRole("link", { name: "Ayuda", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ayuda", level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "Guías" }).getByRole("listitem")).toHaveCount(10);
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("link", { name: /Configurar zonas y tarifas de envío/ }).click();
  await expect(
    page.getByRole("heading", { name: "Configurar zonas y tarifas de envío", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "«Crear zona»" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("link", { name: "Ir a Envíos" }).click();
  await expect(page.getByRole("heading", { name: "Envíos", level: 1 })).toBeVisible();

  // En el celular, sin desbordes.
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of [`${base}/ayuda`, `${base}/ayuda/recibir-y-enviar-pedidos`]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  }
});
