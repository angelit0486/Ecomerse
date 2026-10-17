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
 * Gestión de productos (pedido del propietario, 2026-10-17): publicar y pausar
 * en bloque, miniatura, marca y existencias en el listado, filtros, orden,
 * cambio rápido de precios, reordenar fotos y elegir la foto de cada presentación.
 */
const run = uniq();
const ownerEmail = `gestion-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let wheyId = "";

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`pm${run}`, ownerId);
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [b] = await sql<{ id: string }[]>`
      select public.catalog_upsert_brand(${tenant.storeId}, ${sql.json({ name: "Atlas Nutrición" })}) as id`;
    const [w] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Whey Gestión",
        brand_id: b!.id,
        options: [{ name: "Sabor", values: ["Vainilla", "Chocolate"] }],
        variants: [
          { price: 69900, sku: `GV-${run}`, options: { Sabor: "Vainilla" } },
          { price: 69900, sku: `GC-${run}`, options: { Sabor: "Chocolate" } },
        ],
      })}) as r`;
    wheyId = w!.r.id;
    await sql`select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
      title: "Creatina Gestión",
      variants: [{ price: 49900, sku: `GK-${run}` }],
    })})`;
    await sql`select public.catalog_upsert_category(${tenant.storeId}, ${sql.json({ name: "Creatinas" })})`;
    await sql`select public.inventory_adjust(${tenant.storeId}, v.id, 'adjustment', 12, 'Inicial')
                from public.product_variants v where v.sku = ${`GV-${run}`.toUpperCase()}`;
    // Mínimo de 15: con 12 queda en «pocas existencias».
    await sql`select public.inventory_set_threshold(${tenant.storeId}, v.id, 15)
                from public.product_variants v where v.sku = ${`GV-${run}`.toUpperCase()}`;
  });
  await admin`insert into public.media (store_id, owner_type, product_id, status, storage_path, position, alt_text) values
    (${tenant.storeId}, 'product', ${wheyId}, 'ready', ${`e2e/${run}/frente.webp`}, 0, 'Frente'),
    (${tenant.storeId}, 'product', ${wheyId}, 'ready', ${`e2e/${run}/chocolate.webp`}, 1, 'Chocolate')`;
});

test("listado, acciones en bloque y fotos de cada presentación", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos`);
  const whey = page.getByRole("row").filter({ hasText: "Whey Gestión" });
  await expect(whey.getByText("Atlas Nutrición")).toBeVisible();
  await expect(whey.getByText("12 disponibles")).toBeVisible();
  await expect(whey.getByText("Alguna presentación agotada")).toBeVisible();
  await expect(whey.getByText("Pocas existencias")).toBeVisible();
  await expect(whey.getByText("Pausado (borrador)")).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Pendientes: «Sin foto» deja solo lo que falta fotografiar.
  await page.getByLabel("Pendientes").selectOption("sin_foto");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByRole("link", { name: "Creatina Gestión" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Whey Gestión" })).toHaveCount(0);
  await page.getByLabel("Pendientes").selectOption("pocas_existencias");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page.getByRole("link", { name: "Whey Gestión" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Creatina Gestión" })).toHaveCount(0);
  await page.getByRole("link", { name: "Quitar filtros" }).click();
  await expect(page.getByRole("link", { name: "Whey Gestión" })).toBeVisible();
  // El selector vuelve a «Ninguno»: no reaplica el filtro que se acaba de quitar.
  await expect(page.getByLabel("Pendientes")).toHaveValue("");

  await page.getByLabel("Seleccionar todos").check();
  await page.locator("#bulk-action").selectOption("publish");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("2 productos publicados.")).toBeVisible();
  await expect(whey.getByText("Publicado")).toBeVisible();

  await page.getByLabel("Seleccionar Whey Gestión").check();
  await page.locator("#bulk-action").selectOption("draft");
  await page.getByRole("button", { name: "Aplicar" }).click();
  await expect(page.getByText("1 producto pausado (ya no se ve en la tienda).")).toBeVisible();
  const [row] = await admin<
    { status: string }[]
  >`select status from public.products where id = ${wheyId}`;
  expect(row!.status).toBe("draft");

  // Orden del listado: el más barato primero y luego al revés.
  await page.getByLabel("Ordenar por").selectOption("precio_asc");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/orden=precio_asc/);
  await expect(page.getByRole("row").nth(1)).toContainText("Creatina Gestión");
  await page.getByLabel("Ordenar por").selectOption("precio_desc");
  await page.getByRole("button", { name: "Filtrar" }).click();
  await expect(page).toHaveURL(/orden=precio_desc/);
  await expect(page.getByRole("row").nth(1)).toContainText("Whey Gestión");

  // Cambio rápido de precios sin abrir el producto.
  await whey.getByText("Cambiar precios").click();
  const prices = page.getByRole("form", { name: "Precios de Whey Gestión" });
  await prices.getByLabel("Precio antes de Chocolate").fill("1");
  await prices.getByRole("button", { name: "Guardar precios" }).click();
  await expect(prices.getByText("Debe ser mayor que el precio.")).toBeVisible();
  await prices.getByLabel("Precio antes de Chocolate").fill("");
  await prices.getByLabel("Precio de Vainilla", { exact: true }).fill("649,00");
  await prices.getByLabel("Precio antes de Vainilla").fill("699.00");
  await prices.getByRole("button", { name: "Guardar precios" }).click();
  await expect(prices.getByText("Precio guardado.")).toBeVisible();
  const [vanilla] = await admin<{ price: string; compare_at_price: string }[]>`
    select price, compare_at_price from public.product_variants where sku = ${`GV-${run}`.toUpperCase()}`;
  expect([Number(vanilla!.price), Number(vanilla!.compare_at_price)]).toEqual([64900, 69900]);
  await expect(whey).toContainText("$649.00");
  await expectNoSeriousA11yViolations(page);

  // Ediciones en bloque: marca, categoría y precios por porcentaje con vista previa.
  const creatina = page.getByRole("row").filter({ hasText: "Creatina Gestión" });
  await page.getByLabel("Seleccionar Creatina Gestión").check();
  await page.getByLabel("Acción masiva").selectOption("brand");
  await page.getByLabel("Marca para los seleccionados").selectOption({ label: "Atlas Nutrición" });
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(page.getByText("1 producto con la marca nueva.")).toBeVisible();
  await expect(creatina.getByText("Atlas Nutrición")).toBeVisible();

  await page.getByLabel("Seleccionar Creatina Gestión").check();
  await page.getByLabel("Acción masiva").selectOption("category_add");
  await page.getByLabel("Categoría para los seleccionados").selectOption({ label: "Creatinas" });
  await page.getByRole("button", { name: "Aplicar", exact: true }).click();
  await expect(page.getByText("1 producto agregado a la categoría.")).toBeVisible();

  await page.getByLabel("Seleccionar Creatina Gestión").check();
  await page.getByLabel("Acción masiva").selectOption("prices");
  await page.getByLabel("Porcentaje de cambio").fill("10");
  await page.getByLabel("Redondeo").selectOption("peso");
  await page.getByRole("button", { name: "Ver vista previa" }).click();
  const preview = page.getByRole("region", { name: "Vista previa de precios" });
  await expect(preview.getByRole("row").filter({ hasText: "Creatina Gestión" })).toContainText(
    "$549.00",
  );
  const [before] = await admin<{ price: string }[]>`
    select price from public.product_variants where sku = ${`GK-${run}`.toUpperCase()}`;
  expect(Number(before!.price)).toBe(49900);
  await preview.getByRole("button", { name: "Aplicar cambios" }).click();
  await expect(page.getByText("Precios actualizados en 1 producto.")).toBeVisible();
  const [after] = await admin<{ price: string }[]>`
    select price from public.product_variants where sku = ${`GK-${run}`.toUpperCase()}`;
  expect(Number(after!.price)).toBe(54900);
  const [cat] = await admin<{ n: string }[]>`
    select count(*) as n from public.product_categories pc join public.categories c on c.id = pc.category_id
     join public.product_variants v on v.product_id = pc.product_id
     where c.name = 'Creatinas' and v.sku = ${`GK-${run}`.toUpperCase()}`;
  expect(Number(cat!.n)).toBe(1);
  await expectNoSeriousA11yViolations(page);

  // Fotos (misma sesión: la segunda entrada pediría el segundo factor).
  await page.goto(`/admin/${tenant.handle}/productos/${wheyId}`);
  // Existencias por presentación con acceso directo al ajuste.
  await expect(
    page.getByRole("row").filter({ hasText: "Vainilla" }).getByText("12", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Ajustar existencias de Chocolate" }),
  ).toHaveAttribute("href", new RegExp(`/inventario\\?q=GC-${run}`, "i"));
  // Ajuste rápido de existencias desde la ficha.
  const vanillaStock = page.getByRole("form", { name: "Existencias de Vainilla" });
  await vanillaStock.getByLabel("En mano de Vainilla").fill("20");
  await vanillaStock.getByRole("button", { name: "Fijar existencias de Vainilla" }).click();
  await expect(vanillaStock.getByText("Listo: 20 en mano, 20 disponibles.")).toBeVisible();
  await expect(vanillaStock.getByText("20 disponibles", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mover la foto 2 antes" }).click();
  await expect(page.getByText("Foto movida.")).toBeVisible();
  const order = await admin<{ alt_text: string }[]>`
    select alt_text from public.media where product_id = ${wheyId} and deleted_at is null order by position`;
  expect(order.map((m) => m.alt_text)).toEqual(["Chocolate", "Frente"]);

  const section = page.getByRole("region", { name: "Foto de cada presentación" });
  await section
    .getByLabel("Chocolate", { exact: true })
    .selectOption({ label: "Foto 1 · Chocolate" });
  await section.getByRole("button", { name: "Guardar foto de Chocolate" }).click();
  await expect(section.getByText("Foto de la presentación guardada.")).toBeVisible();
  const [v] = await admin<{ alt_text: string }[]>`
    select m.alt_text from public.product_variants v join public.media m on m.id = v.image_id
     where v.sku = ${`GC-${run}`.toUpperCase()}`;
  expect(v!.alt_text).toBe("Chocolate");
  await expectNoSeriousA11yViolations(page);

  // Duplicar copia todo: presentaciones, fotos (con su job de copia) y la foto de cada una.
  await page.getByRole("button", { name: "Duplicar" }).click();
  await expect(page.getByText(/Copia creada como borrador, con sus presentaciones/)).toBeVisible();
  const copyId = page.url().match(/productos\/([0-9a-f-]{36})/)![1]!;
  expect(copyId).not.toBe(wheyId);
  const photos = await admin<{ alt_text: string; status: string }[]>`
    select alt_text, status from public.media where product_id = ${copyId} order by position`;
  expect(photos).toEqual([
    { alt_text: "Chocolate", status: "pending" },
    { alt_text: "Frente", status: "pending" },
  ]);
  const [jobs] = await admin<{ n: string }[]>`
    select count(*) as n from system.jobs j
     where j.type = 'media.copy' and (j.payload ->> 'media_id')::uuid in
           (select id from public.media where product_id = ${copyId})`;
  expect(Number(jobs!.n)).toBe(2);
  const [chocolate] = await admin<{ alt_text: string }[]>`
    select m.alt_text from public.product_variants v join public.media m on m.id = v.image_id
     where v.product_id = ${copyId} and v.option_signature = 'Sabor=Chocolate'`;
  expect(chocolate!.alt_text).toBe("Chocolate");
});
