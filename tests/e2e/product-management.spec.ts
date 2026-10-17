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
 * en bloque, miniatura, marca y existencias en el listado, reordenar fotos y
 * elegir la foto de cada presentación.
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
    await sql`select public.inventory_adjust(${tenant.storeId}, v.id, 'adjustment', 12, 'Inicial')
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
  await expect(whey.getByText("Pausado (borrador)")).toBeVisible();
  await expectNoSeriousA11yViolations(page);

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

  // Fotos (misma sesión: la segunda entrada pediría el segundo factor).
  await page.goto(`/admin/${tenant.handle}/productos/${wheyId}`);
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
});
