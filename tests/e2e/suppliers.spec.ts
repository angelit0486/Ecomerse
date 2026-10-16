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
 * ADR-025 · Proveedores: la dueña da de alta un proveedor, vincula una variante
 * por SKU con la disponibilidad que le informaron y la tienda la vende; al
 * informar «No disponible», la tienda la muestra agotada.
 */
const run = uniq();
const ownerEmail = `prov-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const SKU = `PROV-${run}`.toUpperCase();

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`pv${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() - interval '60 days' where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Creatina de proveedor",
        slug: "creatina-proveedor",
        variants: [{ price: 49900, sku: SKU }],
      })}) as r`;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
  });
});

test("alta de proveedor, disponibilidad vendible y agotado al quedarse sin piezas", async ({
  page,
}) => {
  const product = `http://${tenant.handle}.localhost:3000/productos/creatina-proveedor`;
  await page.goto(product);
  await expect(page.getByText("Agotado").first()).toBeVisible();

  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos`);
  await page.getByRole("link", { name: "Proveedores" }).click();
  await page.getByLabel("Nombre del proveedor").fill("Distribuidora Norte");
  await page.getByLabel("Plazo de despacho mínimo (días)").fill("2");
  await page.getByLabel("Plazo de despacho máximo (días)").fill("4");
  await page.getByRole("button", { name: "Agregar proveedor" }).click();
  await expect(page.getByText("Proveedor «Distribuidora Norte» creado.")).toBeVisible();
  await page.getByRole("link", { name: "Distribuidora Norte" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Distribuidora Norte" })).toBeVisible();

  const link = page.getByRole("region", { name: "Variantes que surte" });
  await link.getByLabel("SKU de tu tienda").fill(SKU.toLowerCase());
  await link.getByLabel("SKU del proveedor").fill("DN-778");
  await link.getByLabel("Costo de adquisición").fill("250.00");
  await link.getByLabel("Piezas informadas").first().fill("6");
  await link.getByRole("button", { name: "Vincular variante" }).click();
  await expect(link.getByText("Guardado. Disponibles del proveedor: 6.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(/Disponible · 6 informadas · en venta 6, reservadas 0/),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // La tienda lo vende (la caché se invalidó al guardar).
  await page.goto(product);
  await expect(page.getByRole("button", { name: "Agregar al carrito" })).toBeEnabled();

  // El proveedor ya no tiene piezas: agotado en la tienda.
  await page.goto(`/admin/${tenant.handle}/productos/proveedores`);
  await page.getByRole("link", { name: "Distribuidora Norte" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Creatina de proveedor" });
  await row.getByLabel("Disponibilidad informada").selectOption("unavailable");
  await row.getByRole("button", { name: "Actualizar disponibilidad" }).click();
  await expect(row.getByText("Guardado. Disponibles del proveedor: 0.")).toBeVisible();
  await page.goto(product);
  await expect(page.getByText("Agotado").first()).toBeVisible();
});
