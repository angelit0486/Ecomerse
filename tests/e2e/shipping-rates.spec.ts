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
 * Hallazgo del ensayo O10-01: la tarifa creada desde el panel quedaba
 * inactiva aunque «Activa» estuviera marcada (el campo oculto «0» va antes que
 * la casilla y se leía solo el primer valor). Sin tarifa activa la tienda no
 * se puede publicar.
 */
const run = uniq();
const ownerEmail = `tarifas-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`tr${run}`, await createAuthUser(ownerEmail));
});

const rateActive = async () => {
  const [row] = await admin<{ is_active: boolean }[]>`
    select r.is_active from public.shipping_rates r
     where r.store_id = ${tenant.storeId} and r.name = 'Estándar'`;
  return row?.is_active;
};

test("la tarifa nueva queda activa y la casilla «Activa» la enciende y apaga", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/envios`);
  await page.getByRole("textbox", { name: "Nombre de la zona", exact: true }).fill("México");
  await page.getByRole("button", { name: "Crear zona" }).click();
  await expect(page.getByRole("textbox", { name: "Nombre de la zona México" })).toBeVisible();

  const nueva = page.getByRole("form", { name: /Nueva tarifa/ }).or(
    page.locator("form").filter({
      has: page.getByRole("button", { name: "Agregar tarifa" }),
    }),
  );
  await nueva.getByRole("textbox", { name: "Nombre de la tarifa", exact: true }).fill("Estándar");
  await nueva.getByRole("textbox", { name: /^Precio/ }).fill("99");
  await expect(nueva.getByRole("checkbox", { name: "Activa" })).toBeChecked();
  await nueva.getByRole("button", { name: "Agregar tarifa" }).click();
  await expect(page.getByRole("textbox", { name: "Nombre de la tarifa Estándar" })).toBeVisible();
  expect(await rateActive()).toBe(true);

  // Apagarla y volver a encenderla desde su propio formulario.
  const guardada = page.locator("form").filter({
    has: page.getByRole("textbox", { name: "Nombre de la tarifa Estándar" }),
  });
  await guardada.getByRole("checkbox", { name: "Activa" }).uncheck();
  await guardada.getByRole("button", { name: "Guardar tarifa" }).click();
  await expect.poll(rateActive).toBe(false);
  await page.reload();
  await expect(guardada.getByRole("checkbox", { name: "Activa" })).not.toBeChecked();
  await guardada.getByRole("checkbox", { name: "Activa" }).check();
  await guardada.getByRole("button", { name: "Guardar tarifa" }).click();
  await expect.poll(rateActive).toBe(true);
  await expectNoSeriousA11yViolations(page);
});
