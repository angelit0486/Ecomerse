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
 * Envíos nacionales (panel, 2026-11-26): «Envía a todo México en un paso» y los
 * estados de una zona elegidos de la lista, con los mismos nombres que usa el
 * checkout (antes se escribían a mano y un error de dedo dejaba la zona sin aplicar).
 */
const run = uniq();
const ownerEmail = `envios-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`en${run}`, await createAuthUser(ownerEmail));
});

test("todo México en un paso y una zona por estados elegidos de la lista", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/envios`);
  const quick = page.getByRole("form", { name: "Envía a todo México en un paso" });
  await expectNoSeriousA11yViolations(page);

  // Validación: sin costo no se crea nada.
  await quick.getByRole("button", { name: "Crear envío a todo México" }).click();
  await expect(quick.getByText("Escribe el costo del envío (puede ser 0).").first()).toBeVisible();

  await quick.getByLabel(/^Costo del envío/).fill("149");
  await quick.getByLabel(/^Gratis desde/).fill("999");
  await quick.getByRole("button", { name: "Crear envío a todo México" }).click();
  // La zona aparece y el «Listo» sigue a la vista (no se va con el formulario).
  await expect(page.getByRole("textbox", { name: "Nombre de la zona Todo México" })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Listo: ya envías a todo México." }),
  ).toBeVisible();
  // Con una zona creada ya no se ofrece el paso rápido.
  await expect(quick).toHaveCount(0);

  const rates = await admin<{ name: string; type: string; price: string; free: string | null }[]>`
    select r.name, r.type, r.price::text as price, r.free_over_subtotal::text as free
      from public.shipping_rates r join public.shipping_zones z on z.id = r.zone_id
     where z.store_id = ${tenant.storeId} and z.name = 'Todo México' order by r.name`;
  expect(rates).toEqual([
    { name: "Envío estándar", type: "flat", price: "14900", free: null },
    { name: "Envío gratis", type: "free_over", price: "0", free: "99900" },
  ]);

  // Zona por estados: se eligen de la lista, no se escriben.
  const form = page.getByRole("region", { name: "Agregar una zona" });
  await form.getByRole("textbox", { name: "Nombre de la zona", exact: true }).fill("Norte");
  await form.getByText("Todo el país").click();
  await form.getByRole("checkbox", { name: "Nuevo León" }).check();
  await form.getByRole("checkbox", { name: "Coahuila" }).check();
  await expect(
    form.getByText("Coahuila, Nuevo León").or(form.getByText("Nuevo León, Coahuila")),
  ).toBeVisible();
  await form.getByRole("button", { name: "Crear zona" }).click();
  await expect(page.getByRole("textbox", { name: "Nombre de la zona Norte" })).toBeVisible();
  const [zone] = await admin<{ regions: string[] }[]>`
    select regions from public.shipping_zones where store_id = ${tenant.storeId} and name = 'Norte'`;
  expect([...zone!.regions].sort()).toEqual(["Coahuila", "Nuevo León"]);
  await expectNoSeriousA11yViolations(page);
});
