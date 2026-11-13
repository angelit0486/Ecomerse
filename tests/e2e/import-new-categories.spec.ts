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
 * ADR-065 opción A (Orden 10, mensaje 4): la vista previa lista las categorías
 * que faltan con cuántos productos las usan; crearlas está apagado por defecto;
 * se eligen y se confirman de forma explícita; un nombre que choca con otra
 * categoría no se puede crear; se crean al aplicar la importación.
 */
const run = uniq();
const ownerEmail = `categorias-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`nc${run}`, await createAuthUser(ownerEmail));
  await admin`insert into public.categories (store_id, name, slug) values
              (${tenant.storeId}, 'Ropa', 'ropa'), (${tenant.storeId}, 'Lácteos', 'lacteos')`;
});

const categories = async () =>
  admin<{ name: string; products: number }[]>`
    select c.name, (select count(*)::int from public.product_categories pc
                     where pc.store_id = c.store_id and pc.category_id = c.id) as products
      from public.categories c where c.store_id = ${tenant.storeId} and c.deleted_at is null
     order by c.name`;

test("crear categorías al importar: apagado, vista previa, elección y creación al aplicar", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/importar`);
  await page
    .getByLabel("Filas copiadas de tu hoja")
    .fill(
      [
        "Producto\tPrecio\tCategoría",
        "Tenis blanco\t999\tCalzado",
        "Tenis negro\t999\tcalzado",
        "Playera\t199\tRopa",
        "Gorra\t149\tGorras",
        "Termo\t250\tLacteos",
      ].join("\n"),
    );
  await page.getByRole("button", { name: "Validar filas" }).click();
  await expect(page.getByRole("heading", { name: "hoja-pegada.csv" })).toBeVisible();

  // Vista previa: qué falta, con cuántos productos; nada se crea por defecto.
  const section = page.getByRole("region", { name: "Categorías que no existen en tu tienda" });
  const missing = section
    .getByRole("list", { name: "Categorías que faltan" })
    .getByRole("listitem");
  await expect(missing).toHaveCount(3);
  await expect(missing.filter({ hasText: "Calzado" })).toContainText("2 productos");
  await expect(missing.filter({ hasText: "Lacteos" })).toContainText("Ya existe «Lácteos»");
  const toggle = section.getByRole("checkbox", { name: "Crear las categorías que falten" });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Confirmar importación" })).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);

  // Confirmación explícita: se elige cuáles (Gorras no) y se revalida.
  await toggle.check();
  const choose = section.getByRole("group", { name: "Elige cuáles crear" });
  await expect(choose.getByRole("checkbox")).toHaveCount(2);
  await choose.getByRole("checkbox", { name: /^Gorras/ }).uncheck();
  await section.getByRole("button", { name: "Usar estas categorías y revisar de nuevo" }).click();
  await expect(section.getByRole("status")).toContainText("Se crearán al confirmar la importación");
  await expect(section.getByRole("status")).toContainText("«Calzado»");
  // Siguen con error las filas de Gorras y de Lacteos.
  await expect(
    page.locator("dl > div").filter({ hasText: "Filas con error" }).locator("dd"),
  ).toHaveText("2");
  expect(await categories()).toEqual([
    { name: "Lácteos", products: 0 },
    { name: "Ropa", products: 0 },
  ]);

  // Al aplicar se crea «Calzado» una vez, con sus dos productos.
  await page.getByRole("button", { name: "Importar solo los productos sin errores" }).click();
  await expect(async () => {
    await runJobs();
    await expect(page.getByText("Importación terminada.")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByText("Se creó 1 categoría nueva.")).toBeVisible();
  expect(await categories()).toEqual([
    { name: "Calzado", products: 2 },
    { name: "Lácteos", products: 0 },
    { name: "Ropa", products: 1 },
  ]);
});
