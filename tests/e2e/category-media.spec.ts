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
 * Misión Panel, Paso A: la dueña sube fotos de varias categorías a la vez
 * (asignadas por el nombre del archivo) y el banner de una desde el celular;
 * la tienda los muestra en el encabezado de la categoría y en el menú, con
 * iniciales cuando no hay foto.
 */
const run = uniq();
const ownerEmail = `categorias-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

const store = () => `http://${tenant.handle}.localhost:3000`;
const png = (color: string, width = 600, height = 600) =>
  sharp({ create: { width, height, channels: 4, background: color } })
    .withExif({ IFD0: { Artist: "Fotógrafa" } })
    .png()
    .toBuffer();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`cm${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    for (const [name, title] of [
      ["Proteínas", "Proteína Vainilla"],
      ["Creatinas", "Creatina Pura"],
    ] as const) {
      const [category] = await sql<{ id: string }[]>`
        select public.catalog_upsert_category(${tenant.storeId}, ${sql.json({ name })}) as id`;
      const sku = `${title.slice(0, 4).toUpperCase()}-${run}`;
      const [p] = await sql<{ r: { id: string } }[]>`
        select public.catalog_upsert_product(${tenant.storeId},
          ${sql.json({ title, category_ids: [category!.id], variants: [{ price: 29900, sku }] })}) as r`;
      const [v] = await sql<{ id: string }[]>`
        select id from public.product_variants where store_id = ${tenant.storeId} and sku = ${sku.toUpperCase()}`;
      await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 5, 'Inicial')`;
      await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
    }
  });
});

test("fotos de varias categorías y banner desde el celular", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/categorias`);
  await expect(page.getByText("2 categorías no tienen foto")).toBeVisible();

  // Varias fotos a la vez: se asignan por el nombre del archivo.
  await page.locator('input[type="file"][multiple]').setInputFiles([
    { name: "proteinas.png", mimeType: "image/png", buffer: await png("#aa2200") },
    { name: "vitaminas.png", mimeType: "image/png", buffer: await png("#0055aa") },
  ]);
  await expect(page.getByLabel("Categoría de proteinas.png")).toHaveValue(/.+/);
  await expect(page.getByLabel("Categoría de vitaminas.png")).toHaveValue("");
  await page.getByRole("button", { name: "Subir 1 foto" }).click();
  await expect(page.getByRole("status").filter({ hasText: "1 foto subida." })).toBeVisible({
    timeout: 20_000,
  });
  await runJobs();
  await page.reload();
  await expect(page.getByText("1 categoría no tiene foto")).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Banner de Creatinas, encuadrado en franja.
  const creatinas = page.getByRole("listitem").filter({ hasText: "/creatinas" });
  await creatinas.getByText("Fotos de Creatinas").click();
  await creatinas.getByLabel("Elegir banner").setInputFiles({
    name: "banner.png",
    mimeType: "image/png",
    buffer: await png("#116633", 1600, 900),
  });
  await expect(creatinas.getByRole("img", { name: "Banner de Creatinas" })).toBeVisible();
  await creatinas.getByRole("button", { name: "Subir banner" }).click();
  await expect(creatinas.getByRole("status").filter({ hasText: "Listo." })).toBeVisible({
    timeout: 20_000,
  });
  await runJobs();

  // Re-codificadas, de la misma tienda y con texto alternativo desde el nombre.
  const media = await admin<{ owner_type: string; status: string; alt_text: string }[]>`
    select m.owner_type, m.status, m.alt_text from public.categories c
      join public.media m on m.store_id = c.store_id and m.id in (c.image_media_id, c.cover_media_id)
     where c.store_id = ${tenant.storeId} order by m.alt_text`;
  expect(media.map((m) => m.alt_text)).toEqual(["Banner de Creatinas", "Foto de Proteínas"]);
  expect(media.every((m) => m.owner_type === "category" && m.status === "ready")).toBe(true);

  // Tienda: banner arriba de la categoría y foto en el menú del celular.
  await page.goto(`${store()}/categoria/creatinas`);
  const header = page.locator("main header").first();
  await expect(header.locator("img")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "Creatinas" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("button", { name: /Menú/ }).first().click();
  const menu = page.getByRole("navigation", { name: "Principal" }).last();
  await expect(menu.getByRole("link", { name: "Proteínas" }).locator("img")).toHaveCount(1);
  await expect(menu.getByRole("link", { name: "Creatinas" }).locator("img")).toHaveCount(0);

  // Quitar la foto pide confirmación y la borra.
  await page.goto(`/admin/${tenant.handle}/productos/categorias`);
  const proteinas = page.getByRole("listitem").filter({ hasText: "/proteinas" });
  await proteinas.getByText("Fotos de Proteínas").click();
  await proteinas.getByRole("button", { name: "Quitar foto" }).click();
  await proteinas.getByRole("button", { name: "Sí, quitar foto" }).click();
  await expect(proteinas.getByRole("status").filter({ hasText: "Foto quitada." })).toBeVisible();
  await expect(page.getByText("2 categorías no tienen foto")).toBeVisible();
});
