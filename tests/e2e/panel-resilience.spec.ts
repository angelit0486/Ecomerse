import { expect, test } from "@playwright/test";

import { createAuthUser, createTenant, loginNewStaff, uniq } from "./support";

/**
 * Auditoría de detalles, D-9 y D-10: guardar sin conexión o con la sesión vencida
 * no cambia la pantalla por la de error, dice qué hacer y conserva lo escrito.
 */
const run = uniq();
const email = `resiliencia-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`r${run}`, await createAuthUser(email));
});

test("sin conexión y con la sesión vencida, el formulario sigue y lo escrito no se pierde", async ({
  page,
  context,
}) => {
  await loginNewStaff(page, email);
  await page.goto(`/admin/${tenant.handle}/envios`);
  const name = page.getByLabel("Nombre de la zona");
  const create = page.getByRole("button", { name: "Crear zona" });

  await name.fill("Zona Norte");
  await context.setOffline(true);
  await create.click();
  await expect(
    page.getByText(/^Sin conexión a internet: no pudimos confirmar si se guardó/),
  ).toBeVisible();
  await expect(page.getByText("Algo falló al cargar esta pantalla")).toHaveCount(0);
  await expect(name).toHaveValue("Zona Norte");
  await context.setOffline(false);

  await context.clearCookies();
  await name.fill("Zona Sur");
  await create.click();
  await expect(
    page.getByText(/^Tu sesión terminó\. Inicia sesión de nuevo en otra pestaña/),
  ).toBeVisible();
  await expect(name).toHaveValue("Zona Sur");
});
