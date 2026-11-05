import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  runJobs,
  uniq,
} from "./support";

/**
 * Pegar filas desde Excel o Google Sheets (plan 2026-11-05, fase C): lo pegado
 * pasa por el mismo importador que un archivo (vista previa con errores por
 * fila, confirmación todo o nada, y nada cambia hasta confirmar), sin que la
 * dueña tenga que inventar el nombre corto de cada producto.
 */
const run = uniq();
const ownerEmail = `pegar-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`pg${run}`, await createAuthUser(ownerEmail));
  await admin`insert into public.categories (store_id, name, slug)
              values (${tenant.storeId}, 'Cocina', 'cocina')`;
});

test("pegar filas: errores por fila, corregir, confirmar y ver los productos en el catálogo", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/importar`);
  const box = page.getByLabel("Filas copiadas de tu hoja");
  const validate = page.getByRole("button", { name: "Validar filas" });
  await expect(validate).toBeDisabled();

  // 1) Una categoría que no existe y un precio mal escrito: la vista previa lo dice por fila.
  const bad = [
    "Producto\tPrecio\tExistencias\tCategoría",
    "Taza de barro\t$199.50\t10\tCocina",
    "Plato hondo\tbarato\t5\tCocina",
    "Jarra grande\t120\t3\tNo existe",
  ].join("\n");
  await box.fill(bad);
  await expect(
    page.getByRole("status").filter({ hasText: "Entendimos 3 productos" }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await validate.click();
  await expect(page.getByRole("heading", { name: "hoja-pegada.csv" })).toBeVisible();
  await expect(page.getByText(/Leímos tu hoja: creamos el nombre corto/)).toBeVisible();
  await expect(page.getByText(/Precio \(columna price\): escribe un importe como/)).toBeVisible();
  await expect(page.getByText(/no existe la categoría No existe/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar importación" })).toHaveCount(0);

  // 2) Corregida, se confirma y los productos quedan en el catálogo con nombre corto propio.
  await page.goto(`/admin/${tenant.handle}/productos/importar`);
  await box.fill(
    [
      "Producto\tPrecio\tExistencias\tCategoría",
      "Taza de barro\t$199.50\t10\tCocina",
      "Plato hondo\t89\t5\tCocina",
      "Jarra grande\t120\t3\t",
    ].join("\n"),
  );
  await validate.click();
  await expect(page.getByRole("heading", { name: "hoja-pegada.csv" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(async () => {
    await runJobs();
    await expect(page.getByText("Importación terminada.")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  const rows = await admin<{ handle: string; title: string; price: string; on_hand: number }[]>`
    select p.slug as handle, p.title, v.price::text, l.on_hand
      from public.products p
      join public.product_variants v on v.product_id = p.id
      join public.inventory_levels l on l.variant_id = v.id
     where p.store_id = ${tenant.storeId} order by p.slug`;
  expect(rows).toEqual([
    { handle: "jarra-grande", title: "Jarra grande", price: "12000", on_hand: 3 },
    { handle: "plato-hondo", title: "Plato hondo", price: "8900", on_hand: 5 },
    { handle: "taza-de-barro", title: "Taza de barro", price: "19950", on_hand: 10 },
  ]);
  const [category] = await admin<{ n: number }[]>`
    select count(*)::int as n from public.product_categories pc
      join public.categories c on c.id = pc.category_id
      join public.products p on p.id = pc.product_id
     where p.store_id = ${tenant.storeId} and c.slug = 'cocina'`;
  expect(category?.n).toBe(2);

  await page.goto(`/admin/${tenant.handle}/productos`);
  await expect(page.getByRole("link", { name: "Taza de barro" })).toBeVisible();

  // 3) Pegar de nuevo con otro precio actualiza el mismo producto (el nombre corto es estable).
  await page.goto(`/admin/${tenant.handle}/productos/importar`);
  await box.fill("Producto\tPrecio\nTaza de barro\t210");
  await validate.click();
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(async () => {
    await runJobs();
    await expect(page.getByText("Importación terminada.")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  const [after] = await admin<{ n: number; price: string }[]>`
    select count(*) over ()::int as n, v.price::text
      from public.products p join public.product_variants v on v.product_id = p.id
     where p.store_id = ${tenant.storeId} and p.slug = 'taza-de-barro'`;
  expect(after).toEqual({ n: 1, price: "21000" });
});
