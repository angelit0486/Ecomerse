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
 * La dueña cambia el nombre de su tienda ya abierta desde Ajustes → «Datos de
 * la tienda» («Configurar tienda» solo está en el menú mientras es borrador), y
 * el nombre nuevo se ve en la tienda y en el selector del panel.
 */
const run = uniq();
const ownerEmail = `renombrar-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`rn${run}`, await createAuthUser(ownerEmail));
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
});

test("la dueña cambia el nombre de su tienda abierta", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  // La CSP con nonce bloquea atributos style; un componente que los escriba deja
  // errores en la consola (el Select de Radix lo hacía en esta pantalla).
  const cspErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && m.text().includes("Content Security Policy"))
      cspErrors.push(m.text());
  });
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  // En el celular el menú del panel está plegado.
  await page.getByRole("button", { name: "Menú" }).click();
  await page.getByRole("link", { name: "Datos de la tienda" }).first().click();
  await expect(page.getByRole("heading", { name: "Datos de la tienda", level: 1 })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  expect(cspErrors).toEqual([]);

  const name = `PRUVA Suplementos ${run}`;
  await page.getByLabel("Nombre de la tienda").fill(name);
  // El email de contacto es obligatorio (la tienda de prueba no lo tiene).
  await page.getByLabel("Email de contacto").fill(`hola-${run}@example.test`);
  await page.getByRole("button", { name: "Guardar datos" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Datos de la tienda guardados." }),
  ).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();

  const [row] = await admin<
    { name: string }[]
  >`select name from public.stores where id = ${tenant.storeId}`;
  expect(row!.name).toBe(name);

  await page.goto(`http://${tenant.handle}.localhost:3000/`);
  await expect(page.getByText(name).first()).toBeVisible();
});
