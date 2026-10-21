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
 * Misión Portada/Marcas, Paso 2: la dueña sube los logos de varias marcas a la
 * vez (asignados por el nombre del archivo), la portada, la descripción y el
 * sitio de una marca desde el celular; la tienda los muestra en el directorio
 * (cuadrícula con iniciales de respaldo) y en la página de cada marca.
 */
const run = uniq();
const ownerEmail = `marcas-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

const store = () => `http://${tenant.handle}.localhost:3000`;
const png = (color: string, width = 600, height = 300) =>
  sharp({ create: { width, height, channels: 4, background: color } })
    .withExif({ IFD0: { Artist: "Diseñadora" } })
    .png()
    .toBuffer();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`mk${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    for (const [brandName, title] of [
      ["Muha Meds", "Creatina Muha"],
      ["Ace Ultra", "Proteína Ace"],
      ["Besos", "Electrolitos Besos"],
    ] as const) {
      const [brand] = await sql<{ id: string }[]>`
        select public.catalog_upsert_brand(${tenant.storeId}, ${sql.json({ name: brandName })}) as id`;
      const sku = `${title.slice(0, 4).toUpperCase()}-${run}`;
      const [p] = await sql<{ r: { id: string } }[]>`
        select public.catalog_upsert_product(${tenant.storeId},
          ${sql.json({ title, brand_id: brand!.id, variants: [{ price: 29900, sku }] })}) as r`;
      const [v] = await sql<{ id: string }[]>`
        select id from public.product_variants where store_id = ${tenant.storeId} and sku = ${sku.toUpperCase()}`;
      await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 5, 'Inicial')`;
      await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
    }
  });
});

test("logos de varias marcas, portada, descripción y sitio desde el celular", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/marcas`);
  await expect(page.getByText("3 marcas no tienen logo")).toBeVisible();

  // Varios logos a la vez: se asignan por el nombre del archivo.
  await page.locator('input[type="file"][multiple]').setInputFiles([
    { name: "muha-meds-logo.png", mimeType: "image/png", buffer: await png("#aa2200") },
    { name: "ACE_ULTRA.png", mimeType: "image/png", buffer: await png("#0055aa") },
    { name: "otra-marca.png", mimeType: "image/png", buffer: await png("#333333") },
  ]);
  await expect(page.getByLabel("Marca de muha-meds-logo.png")).toHaveValue(/.+/);
  await expect(page.getByLabel("Marca de otra-marca.png")).toHaveValue("");
  // La misma marca en dos archivos se bloquea con un aviso (revisión del Paso 2, B7).
  await page.getByLabel("Marca de otra-marca.png").selectOption({ label: "Muha Meds" });
  await expect(
    page.getByRole("alert").filter({ hasText: "Elegiste la misma marca para dos archivos" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Subir \d+ logos?$/ })).toBeDisabled();
  await page
    .getByLabel("Marca de otra-marca.png")
    .selectOption({ label: "Sin marca (no se sube)" });
  await page.getByRole("button", { name: "Subir 2 logos" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 logos subidos." })).toBeVisible({
    timeout: 20_000,
  });
  await runJobs();
  await page.reload();
  await expect(page.getByText("1 marca no tiene logo")).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Portada, descripción y sitio de una marca.
  const muha = page.getByRole("listitem").filter({ hasText: "Muha Meds" });
  await muha.getByText("Editar").click();
  await muha.getByLabel("Elegir portada").setInputFiles({
    name: "portada.png",
    mimeType: "image/png",
    buffer: await png("#116633", 1200, 900),
  });
  await expect(muha.getByRole("img", { name: "Portada de Muha Meds" })).toBeVisible();
  await muha.getByRole("button", { name: "Subir portada" }).click();
  await expect(muha.getByRole("status").filter({ hasText: "Listo." })).toBeVisible({
    timeout: 20_000,
  });
  // Renombrar no cambia la dirección de la marca (M5).
  await muha.getByLabel("Nombre").fill("Muha Meds MX");
  await muha.getByLabel("Descripción (opcional)").fill("Creatinas y proteínas.\nHechas en México.");
  await muha.getByLabel("Sitio web (opcional)").fill("http://muha.example.com");
  await muha.getByRole("button", { name: "Guardar datos de la marca" }).click();
  await expect(muha.getByText("Escribe la dirección completa, con https://")).toBeVisible();
  // El formulario no pierde lo escrito tras el error.
  await expect(muha.getByLabel("Descripción (opcional)")).toHaveValue(/Hechas en México/);
  await muha.getByLabel("Sitio web (opcional)").fill("https://muha.example.com");
  await muha.getByRole("button", { name: "Guardar datos de la marca" }).click();
  await expect(
    muha.getByRole("status").filter({ hasText: "Marca «Muha Meds MX» actualizada." }),
  ).toBeVisible();
  await runJobs();

  // La imagen sale sin EXIF, re-codificada, de la misma tienda.
  const media = await admin<{ owner_type: string; status: string; store_id: string }[]>`
    select m.owner_type, m.status, m.store_id from public.brands b
      join public.media m on m.store_id = b.store_id and m.id in (b.logo_media_id, b.cover_media_id)
     where b.store_id = ${tenant.storeId} and b.slug = 'muha-meds'`;
  expect(media).toHaveLength(2);
  expect(media.every((m) => m.owner_type === "brand" && m.status === "ready")).toBe(true);

  // Tienda: cuadrícula con logos e iniciales; página de la marca con su portada.
  await page.goto(`${store()}/marcas`);
  const grid = page.getByRole("list").filter({ hasText: "Muha Meds" });
  await expect(grid.locator("img")).toHaveCount(2);
  await expect(grid.getByText("B", { exact: true })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.goto(`${store()}/marca/muha-meds`);
  await expect(page.getByRole("img", { name: "Portada de Muha Meds" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Muha Meds MX" })).toBeVisible();
  await expect(page.getByText("Hechas en México.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Sitio de Muha Meds/ })).toHaveAttribute(
    "href",
    "https://muha.example.com",
  );
  await expectNoSeriousA11yViolations(page);

  // Quitar un logo pide confirmación; la tienda vuelve a las iniciales.
  await page.goto(`/admin/${tenant.handle}/productos/marcas`);
  const ace = page.getByRole("listitem").filter({ hasText: "Ace Ultra" });
  await ace.getByText("Editar").click();
  const [aceLogo] = await admin<{ id: string }[]>`
    select logo_media_id as id from public.brands where store_id = ${tenant.storeId} and slug = 'ace-ultra'`;
  await ace.getByRole("button", { name: "Quitar logo" }).click();
  await ace.getByRole("button", { name: "Sí, quitar logo" }).click();
  await expect(ace.getByRole("status").filter({ hasText: "Logo quitado." })).toBeVisible();
  // La imagen quitada no queda huérfana contando en la cuota (M4).
  const [removed] = await admin<{ deleted: boolean }[]>`
    select deleted_at is not null as deleted from public.media where id = ${aceLogo!.id}`;
  expect(removed!.deleted).toBe(true);
  await page.goto(`${store()}/marcas`);
  await expect(page.getByText("AU", { exact: true })).toBeVisible();
});
