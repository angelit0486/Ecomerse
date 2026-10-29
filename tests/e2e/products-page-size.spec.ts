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
 * Misión vendible F3 (panel a escala): con cientos de productos, el listado deja
 * ver 25, 50 o 100 por página, para que una acción en bloque llegue a 100 a la vez.
 */
const run = uniq();
const email = `pagina-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const TOTAL = 101;

test.beforeAll(async () => {
  tenant = await createTenant(`pp${run}`, await createAuthUser(email));
  const ids = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status)
    select ${tenant.storeId}, 'Producto ' || lpad(g::text, 3, '0'), 'producto-' || g, 'draft'
      from generate_series(1, ${TOTAL}) g
    returning id`;
  expect(ids).toHaveLength(TOTAL);
  await admin`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature)
    select ${tenant.storeId}, p.id, upper(p.slug), 10000, ''
      from public.products p where p.store_id = ${tenant.storeId}`;
});

test("el listado muestra 25, 50 o 100 por página y la selección en bloque llega a 100", async ({
  page,
}) => {
  await loginNewStaff(page, email);
  const base = `/admin/${tenant.handle}/productos`;
  await page.goto(`${base}?orden=nombre`);
  const rows = page.getByRole("checkbox", { name: /^Seleccionar Producto/ });
  await expect(rows).toHaveCount(25);
  await expect(page.getByLabel("Mostrar")).toHaveValue("25");

  await page.getByLabel("Mostrar").selectOption("100");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/por=100/);
  await expect(rows).toHaveCount(100);
  await page.getByRole("checkbox", { name: "Seleccionar todos" }).check();
  await expect(
    page.getByRole("checkbox", { name: /^Seleccionar Producto/, checked: true }),
  ).toHaveCount(100);
  await expectNoSeriousA11yViolations(page);

  // Con 100 por página la base no puede devolver la fila 101: aun así sabe que hay más.
  await page.getByRole("link", { name: "Siguiente página" }).click();
  await expect(page).toHaveURL(/por=100/);
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Producto 101", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Siguiente página" })).toHaveCount(0);

  // El tamaño se conserva al volver y un valor manipulado vuelve a 25.
  await page.getByRole("link", { name: "Primera página" }).click();
  await expect(rows).toHaveCount(100);
  await page.goto(`${base}?por=5000`);
  await expect(rows).toHaveCount(25);
});
