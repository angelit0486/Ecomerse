import { expect, test } from "@playwright/test";

import { admin, createAuthUser, createTenant, loginNewStaff, runJobs, uniq } from "./support";

/**
 * Hoja simple con tallas y colores (Orden 09): un comercio de ropa pega su hoja
 * con una fila por talla y color; cada producto queda con sus presentaciones.
 * La hoja de su giro se descarga con los títulos en español.
 */
const run = uniq();
const ownerEmail = `tallas-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`tv${run}`, await createAuthUser(ownerEmail));
});

test("la hoja de ropa trae Talla y Color; pegada con filas por talla crea un producto con presentaciones", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/importar`);

  const link = page.getByRole("link", { name: "Ropa, calzado y accesorios" });
  await expect(link).toBeVisible();
  const response = await page.request.get((await link.getAttribute("href"))!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toContain("hoja-ropa.csv");
  const header = (await response.text()).replace(/^﻿/, "").trim();
  expect(header).toBe(
    "Producto,Talla,Color,Precio,Precio anterior,Existencias,SKU,Código de barras,Marca,Categoría,Descripción,Fotos,Publicado",
  );

  await page
    .getByLabel("Filas copiadas de tu hoja")
    .fill(
      [
        "Producto\tTalla\tColor\tPrecio\tExistencias\tSKU",
        `Playera básica\tCH\tNegro\t199\t5\tPB-CH-N-${run}`,
        `Playera básica\tM\tNegro\t199\t8\tPB-M-N-${run}`,
        `Playera básica\tM\tBlanco\t209\t0\tPB-M-B-${run}`,
        `Gorra lisa\t\t\t149\t3\tGOR-${run}`,
      ].join("\n"),
    );
  await expect(
    page.getByRole("status").filter({ hasText: "Entendimos 2 productos (4 presentaciones)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Validar filas" }).click();
  await expect(page.getByRole("heading", { name: "hoja-pegada.csv" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar importación" }).click();
  await expect(async () => {
    await runJobs();
    await expect(page.getByText("Importación terminada.")).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 60_000 });

  const rows = await admin<{ slug: string; signature: string; price: string; on_hand: number }[]>`
    select p.slug, v.option_signature as signature, v.price::text as price, l.on_hand
      from public.products p
      join public.product_variants v on v.product_id = p.id and v.deleted_at is null
      join public.inventory_levels l on l.variant_id = v.id
     where p.store_id = ${tenant.storeId}
     order by p.slug, v.option_signature`;
  // La firma sigue el orden de las opciones del producto: Talla y luego Color.
  expect(rows).toEqual([
    { slug: "gorra-lisa", signature: "", price: "14900", on_hand: 3 },
    { slug: "playera-basica", signature: "Talla=CH|Color=Negro", price: "19900", on_hand: 5 },
    { slug: "playera-basica", signature: "Talla=M|Color=Blanco", price: "20900", on_hand: 0 },
    { slug: "playera-basica", signature: "Talla=M|Color=Negro", price: "19900", on_hand: 8 },
  ]);
});
