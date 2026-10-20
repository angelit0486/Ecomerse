import { expect, test } from "@playwright/test";

import { readFile } from "node:fs/promises";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  runJobs,
  uniq,
} from "./support";

/** F8-T04b: importación CSV → vista previa con errores por fila → confirmación todo o nada. */
const run = uniq();
const ownerEmail = `importar-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const sku = `IMP-${run.toUpperCase()}`;

const HEADER =
  "handle,title,status,description,brand,categories,tags,option1_name,option1_value,option2_name,option2_value,option3_name,option3_value,sku,barcode,price,compare_at_price,inventory_quantity,inventory_policy,requires_shipping,weight_g,length_mm,width_mm,height_mm,variant_status,seo_title,seo_description";
const line = (cells: Record<number, string>, sep = ",") =>
  Array.from({ length: 27 }, (_, i) => cells[i] ?? "").join(sep);

test.beforeAll(async () => {
  tenant = await createTenant(`im${run}`, await createAuthUser(ownerEmail));
});

test("importar productos: errores por fila, confirmación y producto en el catálogo", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos`);
  await page.getByRole("link", { name: "Importar" }).click();
  await expect(page.getByRole("heading", { name: "Importar productos" })).toBeVisible();

  // 1) Archivo con errores: nada se escribe y cada error dice su fila (la de la hoja,
  //    contando la línea en blanco). Una columna ajena (store_id) se ignora y se avisa.
  const bad = [
    `${HEADER},store_id`,
    "",
    `${line({ 0: "taza-roja", 1: "Taza roja", 5: "No existe", 13: sku, 15: "abc" })},otra-tienda`,
  ].join("\n");
  await page.getByLabel(/Archivo CSV/).setInputFiles({
    name: "malo.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(bad),
  });
  await page.getByRole("button", { name: "Validar archivo" }).click();
  await expect(page.getByRole("heading", { name: "malo.csv" })).toBeVisible();
  await expect(
    page.getByText("Precio (columna price): escribe un importe como 199.50"),
  ).toBeVisible();
  await expect(
    page.getByText("Categorías (columna categories): no existe la categoría No existe"),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "3", exact: true })).toBeVisible();
  await expect(
    page.getByText("Se ignoraron columnas que no son de la plantilla: store_id."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar importación" })).toHaveCount(0);
  // CSV de errores para corregir y volver a subir (§26.1 paso 3).
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Descargar las filas con error (CSV)" }).click(),
  ]);
  const errorsCsv = await readFile((await download.path())!, "utf8");
  expect(errorsCsv).toContain("fila,errores,handle");
  expect(errorsCsv).toContain("price: escribe un importe como 199.50");
  expect(errorsCsv).not.toContain("otra-tienda");

  // 2) Archivo correcto con dos variantes (punto y coma y coma decimal, como Excel en español).
  const good = [
    HEADER.replaceAll(",", ";"),
    line(
      {
        0: "taza-roja",
        1: "Taza roja",
        7: "Tamaño",
        8: "Chica",
        13: sku,
        15: "149,50",
        17: "6",
      },
      ";",
    ),
    line({ 0: "taza-roja", 7: "Tamaño", 8: "Grande", 15: "199,00" }, ";"),
  ].join("\r\n");
  // «Corregir y reintentar» desde la misma vista previa, con el mismo modo.
  await page.getByLabel("Corrige el archivo y súbelo aquí de nuevo").setInputFiles({
    name: "bueno.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(good),
  });
  await page.getByRole("button", { name: "Validar el archivo corregido" }).click();
  await expect(page.getByRole("heading", { name: "bueno.csv" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  // La confirmación la aplica el worker (job import.commit); la página se actualiza sola.
  // Se espera el aviso de la página (no el texto del botón mientras envía): así el job
  // ya está en la cola. El runner se llama como lo haría el cron hasta que termine.
  await expect(page.getByRole("status").filter({ hasText: "Importando…" })).toBeVisible();
  await expect(async () => {
    await runJobs();
    await expect(page.getByText("Importación terminada.")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  const [variant] = await admin<{ price: string; on_hand: number }[]>`
    select v.price::text, l.on_hand from public.product_variants v
      join public.inventory_levels l on l.variant_id = v.id
     where v.store_id = ${tenant.storeId} and v.sku = ${sku}`;
  expect(variant).toEqual({ price: "14950", on_hand: 6 });

  await page.goto(`/admin/${tenant.handle}/productos`);
  await expect(page.getByRole("link", { name: "Taza roja" })).toBeVisible();

  // Otro origen no puede subir archivos.
  const forged = await page.request.post(`/admin/${tenant.handle}/productos/importar/subir`, {
    headers: { origin: "http://malo.test" },
    multipart: { mode: "upsert" },
  });
  expect(forged.status()).toBe(403);
});

test("archivo exportado de Shopify (Latin-1): se traduce, avisa lo que no copia e importa", async ({
  page,
}) => {
  // Tienda y usuaria propias: un segundo inicio de sesión pediría el código 2FA.
  const email = `importar-shopify-${run}@example.test`;
  const shop = await createTenant(`is${run}`, await createAuthUser(email));
  const handle = `whey-${run}`;
  const shopify = [
    "Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Grams,Variant Inventory Qty,Variant Inventory Policy,Variant Price,Variant Compare At Price,Variant Requires Shipping,Image Src,Image Position,Status",
    `${handle},Proteína Whey,<p>Suero de leche</p>,Atlas,Proteínas,"proteína, whey",TRUE,Sabor,Vainilla,SH-V-${run},907,5,deny,899.00,999.00,TRUE,https://cdn.shopify.com/a.jpg,1,active`,
    `${handle},,,,,,,,Chocolate,SH-C-${run},907,-1,deny,899.00,,TRUE,,,`,
    `${handle},,,,,,,,,,,,,,,,https://cdn.shopify.com/b.jpg,2,`,
  ].join("\n");

  await loginNewStaff(page, email);
  await page.goto(`/admin/${shop.handle}/productos/importar`);
  await expect(
    page.getByRole("heading", { name: "¿Ya vendes en Shopify o Tiendanube?" }),
  ).toBeVisible();
  await page.getByLabel(/Archivo CSV/).setInputFiles({
    name: "products_export.csv",
    mimeType: "text/csv",
    // Excel guarda en Windows-1252: «í» es un solo byte.
    buffer: Buffer.from(shopify, "latin1"),
  });
  await page.getByRole("button", { name: "Validar archivo" }).click();
  await expect(page.getByRole("heading", { name: "products_export.csv" })).toBeVisible();
  await expect(page.getByText(/Leímos tu archivo de Shopify/)).toBeVisible();
  await expect(page.getByText(/1 producto trae su foto como enlace/)).toBeVisible();
  await expect(
    page.getByText(/Se ignoraron columnas que no son de la plantilla: type, image position/i),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Importando…" })).toBeVisible();
  await expect(async () => {
    await runJobs();
    await expect(page.getByText("Importación terminada.")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });
  await expect(
    page.getByRole("link", { name: "Subir las fotos de todos los productos" }),
  ).toBeVisible();

  const variants = await admin<
    { title: string; sku: string; price: string; compare: string | null; on_hand: number }[]
  >`
    select p.title, v.sku, v.price::text, v.compare_at_price::text as compare, l.on_hand
      from public.products p
      join public.product_variants v on v.product_id = p.id
      join public.inventory_levels l on l.variant_id = v.id
     where p.store_id = ${shop.storeId} and p.slug = ${handle}
     order by v.sku desc`;
  expect(variants).toEqual([
    {
      title: "Proteína Whey",
      sku: `SH-V-${run}`.toUpperCase(),
      price: "89900",
      compare: "99900",
      on_hand: 5,
    },
    {
      title: "Proteína Whey",
      sku: `SH-C-${run}`.toUpperCase(),
      price: "89900",
      compare: null,
      on_hand: 0,
    },
  ]);
});
