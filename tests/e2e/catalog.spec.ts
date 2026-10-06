import { expect, test } from "@playwright/test";
import sharp from "sharp";

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
 * F3-T05: la "Playera" de 6 variantes de punta a punta en el panel — categoría
 * y marca, editor con opciones, imagen procesada por el worker, publicar,
 * archivar, eliminar y restaurar — con axe en cada pantalla.
 */
const run = uniq();
const ownerEmail = `catalogo-duena-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`c${run}`, ownerId);
});

async function productRow(title: string) {
  const [row] = await admin<{ id: string; status: string; deleted_at: Date | null }[]>`
    select id, status, deleted_at from public.products where store_id = ${tenant.storeId} and title = ${title}`;
  return row;
}

test("la Playera de 6 variantes: crear → imagen → publicar → archivar → eliminar → restaurar", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  const base = `/admin/${tenant.handle}/productos`;

  // Categoría y marca
  await page.goto(`${base}/categorias`);
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("textbox", { name: "Nombre", exact: true }).fill("Ropa");
  await page.getByRole("button", { name: "Crear categoría" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Categoría «Ropa» creada." }),
  ).toBeVisible();

  await page.goto(`${base}/marcas`);
  await page.getByLabel("Nombre de la marca").fill("Pruva Básicos");
  await page.getByRole("button", { name: "Crear marca" }).click();
  await expect(page.getByRole("status").filter({ hasText: "creada" })).toBeVisible();

  // Listado vacío → nuevo producto
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Aún no tienes productos" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("link", { name: "Agregar producto" }).first().click();
  await expect(page.getByRole("heading", { name: "Nuevo producto" })).toBeVisible();

  await page.getByRole("textbox", { name: "Título", exact: true }).fill("Playera Básica");
  await page
    .getByRole("textbox", { name: "Descripción", exact: true })
    .fill("Algodón 100 %.\n\nLavar en frío.");
  await page
    .getByRole("combobox", { name: "Marca", exact: true })
    .selectOption({ label: "Pruva Básicos" });
  await page.getByRole("checkbox", { name: "Ropa" }).check();
  await page.getByRole("button", { name: "Agregar opción" }).click();
  await page.getByRole("textbox", { name: "Opción 1", exact: true }).fill("Color");
  await page.getByLabel("Valores de la opción 1").fill("Negro, Blanco");
  await page.getByRole("button", { name: "Agregar opción" }).click();
  await page.getByRole("textbox", { name: "Opción 2", exact: true }).fill("Talla");
  await page.getByLabel("Valores de la opción 2").fill("CH, M, G");
  await expect(page.getByText("6 variantes")).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Blanco / G" })).toBeVisible();

  // Sin precio no se envía; luego "aplicar a todas".
  await page.getByRole("button", { name: "Crear producto" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Escribe un precio válido" }),
  ).toBeVisible();
  await page.getByLabel("Valor a aplicar (MXN)").fill("199.00");
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await page.getByLabel("SKU de Negro / M").fill("ply-n-m");
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("button", { name: "Crear producto" }).click();

  await expect(
    page.getByRole("status").filter({ hasText: "Producto creado como borrador" }),
  ).toBeVisible();
  const created = await productRow("Playera Básica");
  expect(created?.status).toBe("draft");
  const variants = await admin<{ price: string; sku: string | null }[]>`
    select price, sku from public.product_variants where product_id = ${created!.id} and deleted_at is null`;
  expect(variants).toHaveLength(6);
  expect(variants.every((v) => Number(v.price) === 19900)).toBe(true);
  expect(variants.map((v) => v.sku)).toContain("PLY-N-M");
  const [desc] = await admin<{ description_html: string }[]>`
    select description_html from public.products where id = ${created!.id}`;
  expect(desc!.description_html).toBe("<p>Algodón 100 %.</p><p>Lavar en frío.</p>");

  // Imagen: PUT directo a Storage → worker → visible y sin EXIF
  const photo = await sharp({
    create: { width: 800, height: 800, channels: 3, background: "#222" },
  })
    .withExif({ IFD0: { Artist: "Persona" } })
    .jpeg()
    .toBuffer();
  await page
    .getByLabel("Agregar imágenes")
    .setInputFiles({ name: "playera.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(page.getByRole("status").filter({ hasText: "imagen subida" })).toBeVisible();
  await expect(page.getByText("Procesando…")).toBeVisible();
  await runJobs();
  const image = page.locator("img[src*='/storage/v1/object/public/store-media/']");
  await expect(image).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Texto alternativo").fill("Playera negra de algodón");
  await page.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Texto alternativo guardado." }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Publicar → archivar → eliminar → restaurar
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Producto publicado" })).toBeVisible();
  expect((await productRow("Playera Básica"))?.status).toBe("active");

  await page.getByRole("button", { name: "Archivar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Producto archivado." })).toBeVisible();
  expect((await productRow("Playera Básica"))?.status).toBe("archived");

  await page.getByRole("button", { name: "Eliminar", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${base}\\?eliminado=1$`));
  expect((await productRow("Playera Básica"))?.deleted_at).not.toBeNull();

  await page.getByLabel("Ver eliminados").check();
  await page.getByRole("button", { name: "Filtrar" }).click();
  await page.getByRole("link", { name: "Playera Básica" }).click();
  await page.getByRole("button", { name: "Restaurar" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "restaurado como borrador" }),
  ).toBeVisible();
  const restored = await productRow("Playera Básica");
  expect(restored?.status).toBe("draft");
  expect(restored?.deleted_at).toBeNull();

  // Agregar una opción conserva las variantes existentes (mismo id y SKU).
  const [before] = await admin<{ id: string }[]>`
    select id from public.product_variants where sku = 'PLY-N-M' and deleted_at is null
       and store_id = ${tenant.storeId}`;
  await page.getByRole("button", { name: "Agregar opción" }).click();
  await page.getByRole("textbox", { name: "Opción 3", exact: true }).fill("Material");
  await page.getByLabel("Valores de la opción 3").fill("Algodón");
  await expect(page.getByLabel("SKU de Negro / M / Algodón")).toHaveValue("PLY-N-M");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cambios guardados." })).toBeVisible();
  const [after] = await admin<{ id: string; option_signature: string }[]>`
    select id, option_signature from public.product_variants where sku = 'PLY-N-M' and deleted_at is null
       and store_id = ${tenant.storeId}`;
  expect(after).toEqual({
    id: before!.id,
    option_signature: "Color=Negro|Talla=M|Material=Algodón",
  });
  const [category] = await admin<{ is_visible: boolean }[]>`
    select is_visible from public.categories where store_id = ${tenant.storeId} and name = 'Ropa'`;
  expect(category?.is_visible).toBe(true);

  // Listado: búsqueda por SKU, filtro por estado y acción masiva
  await page.goto(`${base}?q=PLY-N-M`);
  await expect(page.getByRole("link", { name: "Playera Básica" })).toBeVisible();
  await page.goto(`${base}?estado=active`);
  await expect(page.getByRole("heading", { name: "Sin resultados" })).toBeVisible();
  await page.goto(base);
  await page.getByRole("checkbox", { name: "Seleccionar Playera Básica" }).check();
  await page.getByLabel("Acción masiva").selectOption("archive");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 producto archivado." })).toBeVisible();
  expect((await productRow("Playera Básica"))?.status).toBe("archived");
  await expectNoSeriousA11yViolations(page);
});
