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
 * ADR-038: la dueña crea otra tienda desde «Tus tiendas», sin la plataforma.
 * Nace en borrador en su organización y la lleva directo a configurarla; una
 * dirección repetida se explica junto al campo.
 */
const run = uniq();
const ownerEmail = `nueva-${run}@example.test`;
const handle = `marca${run}`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`nt${run}`, await createAuthUser(ownerEmail));
});

test("la dueña crea otra tienda desde su panel", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginNewStaff(page, ownerEmail);
  await page.goto("/admin");
  await page.getByRole("link", { name: /^Nueva tienda en / }).click();
  await expect(page.getByRole("heading", { name: /^Nueva tienda en / })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Dirección repetida: el error va junto al campo y no se pierde lo escrito.
  await page.getByLabel("Nombre de la tienda").fill("Segunda marca");
  await page.getByLabel("Dirección de la tienda").fill(tenant.handle);
  await page.getByRole("button", { name: "Crear tienda" }).click();
  await expect(page.getByText("Ya existe una tienda con esa dirección. Elige otra.")).toBeVisible();
  await expect(page.getByLabel("Nombre de la tienda")).toHaveValue("Segunda marca");

  await page.getByLabel("Dirección de la tienda").fill(handle);
  await page.getByRole("button", { name: "Crear tienda" }).click();
  await page.waitForURL(new RegExp(`/admin/${handle}/configuracion$`));
  await expect(page.getByRole("heading", { name: "Configura tu tienda" })).toBeVisible();

  const [row] = await admin<{ org: string; status: string; name: string }[]>`
    select organization_id::text as org, status, name from public.stores where handle = ${handle}`;
  expect(row).toEqual({ org: tenant.orgId, status: "draft", name: "Segunda marca" });
});
