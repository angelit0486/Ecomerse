import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  uniq,
} from "./support";

/**
 * Descubrimiento (super prompt §5, §7 y §8): rango de precio en la URL con su
 * etiqueta para quitarlo, «Ofertas» solo con descuentos reales, directorio de
 * marcas y accesos del menú que solo aparecen con contenido.
 */
const run = uniq();
let tenant: Awaited<ReturnType<typeof createTenant>>;
const origin = () => `http://${tenant.handle}.localhost:3000`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(`descubre-${run}@example.test`);
  tenant = await createTenant(`ds${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() - interval '60 days' where id = ${tenant.storeId}`;
  await admin`insert into public.brands (store_id, name, slug) values
                (${tenant.storeId}, 'Atlas Nutrición', 'atlas'), (${tenant.storeId}, 'Bruma Labs', 'bruma')`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    let n = 0;
    const product = async (title: string, brand: string, variant: Record<string, unknown>) => {
      const sku = `DS${(n += 1)}-${run}`;
      const [b] = await sql<{ id: string }[]>`
        select id from public.brands where store_id = ${tenant.storeId} and slug = ${brand}`;
      const [p] = await sql<{ r: { id: string } }[]>`
        select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
          title,
          brand_id: b!.id,
          variants: [{ ...variant, sku, inventory_policy: "continue" }],
        })}) as r`;
      await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
    };
    await product("Proteína económica", "atlas", { price: 30000 });
    await product("Proteína premium", "atlas", { price: 90000, compare_at_price: 110000 });
    await product("Electrolitos", "bruma", { price: 15000 });
  });
});

test("rango de precio: filtra, queda en la URL y se quita con su etiqueta", async ({ page }) => {
  await page.goto(`${origin()}/productos`);
  await expect(page.getByText("3 productos")).toBeVisible();
  const filters = page.getByRole("form", { name: "Filtros" }).last();
  await filters.getByLabel("Mínimo").fill("200");
  await filters.getByLabel("Máximo").fill("500");
  await filters.getByRole("button", { name: "Aplicar precio" }).click();
  await expect(page).toHaveURL(/precio_min=200&precio_max=500/);
  await expect(page.getByText("1 producto", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Proteína económica/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Electrolitos/ })).toHaveCount(0);

  // La marca se combina con el precio y sus conteos lo respetan.
  await expect(filters.getByLabel(/Bruma Labs/)).toHaveCount(0);
  const chip = page.getByRole("link", { name: "Quitar el filtro Precio: $200 a $500" });
  await chip.click();
  await expect(page).not.toHaveURL(/precio_min/);
  await expect(page.getByText("3 productos")).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("ofertas: solo descuentos reales, con su acceso en el menú", async ({ page }) => {
  await page.goto(`${origin()}/`);
  const nav = page.getByRole("navigation", { name: "Principal" });
  await nav.getByRole("link", { name: "Ofertas" }).click();
  await expect(page).toHaveURL(/\/ofertas$/);
  await expect(page.getByRole("heading", { level: 1, name: "Ofertas" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Proteína premium/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Proteína económica/ })).toHaveCount(0);
  await expect(page.getByText("1 producto", { exact: true })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("directorio de marcas: solo marcas con productos y enlace a cada una", async ({ page }) => {
  await page.goto(`${origin()}/`);
  await page
    .getByRole("navigation", { name: "Principal" })
    .getByRole("link", { name: "Marcas" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Marcas" })).toBeVisible();
  await expect(page.getByText("2 marcas con productos en la tienda.")).toBeVisible();
  await page.getByRole("link", { name: /Bruma Labs/ }).click();
  await expect(page).toHaveURL(/\/marca\/bruma$/);
  await expect(page.getByRole("link", { name: /Electrolitos/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Proteína/ })).toHaveCount(0);
});

test("móvil: el botón de filtros cuenta el precio activo", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${origin()}/productos?precio_max=400&oferta=1`);
  await expect(page.getByText("Filtros (2)")).toBeVisible();
  await expect(page.getByText("Ningún producto coincide con estos filtros")).toBeVisible();
});
