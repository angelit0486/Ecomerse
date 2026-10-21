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
 * Misión panel, Fase 4: el panel en el celular. Menú agrupado con «Menú», «Más del
 * catálogo», controles de 44 px, la ficha sin desplazamiento lateral a 375 px y
 * la imagen sin descripción con nombre en Apariencia → SEO. Pulido (D-1): el
 * editor de una página cabe en 375 px con su vista previa de Google y sus
 * títulos van en orden.
 */
const run = uniq();
const ownerEmail = `movil-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let productId = "";

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`mv${run}`, ownerId);
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Proteína Móvil",
        options: [{ name: "Sabor", values: ["Vainilla francesa", "Chocolate con avellana"] }],
        variants: [
          { price: 69900, sku: `MV-${run}`, options: { Sabor: "Vainilla francesa" } },
          { price: 69900, sku: `MC-${run}`, options: { Sabor: "Chocolate con avellana" } },
        ],
      })}) as r`;
    productId = p!.r.id;
  });
  // Una descripción larga en la foto ensanchaba el selector de cada presentación.
  await admin`insert into public.media (store_id, owner_type, product_id, status, storage_path, position, alt_text) values
    (${tenant.storeId}, 'product', ${productId}, 'ready', ${`e2e/${run}/frente.webp`}, 0,
     'Bote de proteína sabor vainilla francesa visto de frente con la etiqueta completa')`;
  // Banner con descripción vacía: su opción en SEO quedaba sin nombre.
  await admin`insert into public.media (store_id, owner_type, status, storage_path, position, alt_text) values
    (${tenant.storeId}, 'banner', 'ready', ${`e2e/${run}/banner.webp`}, 0, '')`;
});

test.use({ viewport: { width: 375, height: 812 } });

test("el panel en el celular: menú, catálogo, ficha y SEO", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  const nav = page.getByRole("navigation", { name: "Secciones de la tienda" });

  // Lo de todos los días a la vista; el resto, agrupado detrás de «Menú».
  await expect(nav.getByRole("link", { name: "Pedidos", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Equipo" })).toBeHidden();
  const menu = nav.getByRole("button", { name: "Menú" });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  expect((await menu.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await menu.click();
  await expect(nav.getByText("Ajustes", { exact: true })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await nav.getByRole("link", { name: "Productos" }).last().click();
  await expect(page.getByRole("heading", { name: "Productos", level: 1 })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Menú" })).toHaveAttribute("aria-expanded", "false");

  // Productos: dos acciones a la vista y el resto en «Más del catálogo».
  const catalog = page.getByRole("navigation", { name: "Catálogo" });
  await expect(catalog.getByRole("link", { name: "Ofertas" })).toBeHidden();
  const add = catalog.getByRole("link", { name: "Agregar producto" });
  expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await catalog.getByText("Más del catálogo").click();
  await expect(catalog.getByRole("link", { name: "Ofertas" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // La ficha cabe en 375 px.
  await page.goto(`/admin/${tenant.handle}/productos/${productId}`);
  await expect(page.locator('select[name="media_id"]').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // SEO: la imagen sin descripción tiene nombre.
  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=seo`);
  await expect(page.getByRole("radio", { name: "Imagen sin descripción" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Editor de una página: la URL larga de la vista previa no ensancha la pantalla.
  const [policy] = await admin<{ id: string }[]>`
    select id from public.store_pages where store_id = ${tenant.storeId} and type = 'policy_privacy'`;
  await page.goto(`/admin/${tenant.handle}/contenido/paginas/${policy!.id}`);
  await expect(page.getByRole("heading", { name: "Así se vería" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await expectNoSeriousA11yViolations(page, { includeModerate: true });
});
