import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/**
 * Ajustes → Funciones: la dueña enciende o apaga funciones de SU tienda sin
 * pedírselo a la plataforma. La portada de imágenes nace encendida; al apagarla
 * el editor ya no la ofrece, y al encenderla vuelve. Otra tienda no cambia.
 */
const run = uniq();
const ownerEmail = `funciones-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let other: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`fn${run}`, await createAuthUser(ownerEmail));
  other = await createTenant(`fo${run}`, await createAuthUser(`otra-${run}@example.test`));
});

test("apagar y encender la portada de imágenes desde el panel", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  await page.getByRole("link", { name: "Funciones" }).first().click();
  await expect(page.getByRole("heading", { name: "Funciones", level: 1 })).toBeVisible();
  const card = page.getByRole("form", { name: "Portada de imágenes" });
  await expect(card.getByText("Encendida", { exact: true })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  const offered = async () => {
    await page.goto(`/admin/${tenant.handle}/apariencia?seccion=portada`);
    return page.getByLabel("Nuevo bloque").locator("option").allTextContents();
  };
  expect(await offered()).toContain("Portada de imágenes");

  await page.goto(`/admin/${tenant.handle}/ajustes/funciones`);
  await card.getByRole("button", { name: "Apagar portada de imágenes" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Portada de imágenes: apagada." }),
  ).toBeVisible();
  await expect(card.getByText("Apagada", { exact: true })).toBeVisible();
  expect(await offered()).not.toContain("Portada de imágenes");

  await page.goto(`/admin/${tenant.handle}/ajustes/funciones`);
  await card.getByRole("button", { name: "Encender portada de imágenes" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Portada de imágenes: encendida." }),
  ).toBeVisible();
  expect(await offered()).toContain("Portada de imágenes");

  // La otra tienda nunca cambió y queda en la auditoría de esta.
  const [o] = await admin<{ n: number }[]>`
    select count(*)::int as n from public.feature_flag_overrides where scope_id = ${other.storeId}`;
  expect(o!.n).toBe(0);
  const [a] = await admin<{ n: number }[]>`
    select count(*)::int as n from audit.audit_logs
     where action = 'store.feature_changed' and store_id = ${tenant.storeId}`;
  expect(a!.n).toBe(2);

  // En el celular, la pantalla se usa sin desbordarse.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/admin/${tenant.handle}/ajustes/funciones`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
});
