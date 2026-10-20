import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/**
 * F9-T02 (GATE0 §20.2, F9-DESIGN §3, §7): la dueña arma la portada por
 * secciones (agregar, editar, ordenar con teclado, eliminar), la ve en la vista
 * previa y la publica. "Comprar por objetivo" lleva al listado filtrado.
 */
const run = uniq();
const ownerEmail = `portada-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId = "";

const store = () => `http://${tenant.handle}.localhost:3000`;

/** Registra las violaciones de CSP de todas las páginas del contexto (también las pestañas nuevas). */
async function trackCsp(target: Page | BrowserContext) {
  await target.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(
        `${e.violatedDirective} ${e.blockedURI}`,
      ),
    );
  });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`po${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const attribute = await sql<{ id: string }[]>`
      select public.catalog_save_attribute(${tenant.storeId},
        ${sql.json({ name: "Objetivo", values: [{ label: "Energía" }, { label: "Fuerza" }] })}) as id`;
    // Con existencias: la portada nunca muestra agotados (Gate F9, pgTAP 57).
    const product = async (title: string, price: number) => {
      const sku = `${title.slice(0, 4).toUpperCase()}-${run}`;
      const [p] = await sql<{ r: { id: string } }[]>`
        select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({ title, variants: [{ price, sku }] })}) as r`;
      const [v] = await sql<{ id: string }[]>`
        select id from public.product_variants where store_id = ${tenant.storeId} and sku = ${sku.toUpperCase()}`;
      await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 10, 'Inicial')`;
      await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
      return p!.r.id;
    };
    const cafeina = await product("Cafeína anhidra", 19900);
    await product("Creatina monohidratada", 49900);
    const [energia] = await sql<{ id: string }[]>`
      select id from public.attribute_values where attribute_id = ${attribute[0]!.id} and key = 'energia'`;
    await sql`select public.catalog_set_product_attributes(${tenant.storeId}, ${cafeina}, ${[energia!.id]}::uuid[])`;
  });
});

test("armar la portada por secciones, vista previa y publicar", async ({ page, browser }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=portada`);
  await expect(
    page.getByText(/Sin secciones, la portada muestra la plantilla del tema/),
  ).toBeVisible();

  // Hero.
  await page.getByLabel("Nuevo bloque").selectOption({ label: "Portada principal" });
  await page.getByRole("button", { name: "Agregar bloque" }).click();
  const hero = page.getByRole("listitem").filter({ hasText: "1. Portada principal" });
  await hero.getByLabel("Título", { exact: true }).fill("Suplementos para cada objetivo");
  await hero.getByLabel("Texto del botón (opcional)").fill("Ver productos");
  await hero.getByLabel("Enlace del botón").fill("/productos");

  // Comprar por objetivo.
  await page.getByLabel("Nuevo bloque").selectOption({ label: "Productos destacados" });
  await page.getByRole("button", { name: "Agregar bloque" }).click();
  const products = page.getByRole("listitem").filter({ hasText: "2. Productos destacados" });
  await products.getByLabel("Título", { exact: true }).fill("Para tu energía");
  await products
    .getByLabel("Qué productos mostrar")
    .selectOption({ label: "De un objetivo (u otro filtro)" });
  await products
    .getByLabel("Objetivo", { exact: true })
    .selectOption({ label: "Objetivo: Energía" });

  // Una sección incompleta se marca y no se guarda nada.
  await page.getByLabel("Nuevo bloque").selectOption({ label: "Imagen con texto" });
  await page.getByRole("button", { name: "Agregar bloque" }).click();
  await page.getByRole("button", { name: "Guardar portada en el borrador" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Imagen: Elige una opción." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Eliminar Imagen con texto" }).click();
  await expectNoSeriousA11yViolations(page);

  // Ordenar con teclado: el foco sigue a la sección y se anuncia la posición.
  await page.getByRole("button", { name: "Subir Productos destacados (posición 2)" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Productos destacados movida a la posición 1 de 2.")).toBeAttached();
  await expect(
    page.getByRole("button", { name: "Bajar Productos destacados (posición 1)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bajar Productos destacados (posición 1)" }).click();
  await expect(page.getByRole("heading", { name: "1. Portada principal" })).toBeVisible();

  await page.getByRole("button", { name: "Guardar portada en el borrador" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Portada guardada en el borrador" }),
  ).toBeVisible();

  // Comprador: sigue la plantilla.
  const buyer = await browser.newContext();
  const shopper = await buyer.newPage();
  await trackCsp(shopper);
  await shopper.goto(store());
  await expect(shopper.getByRole("heading", { level: 1 })).toHaveText(tenant.name);

  // Vista previa: la portada del borrador.
  await trackCsp(page.context());
  const [preview] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("link", { name: /Vista previa/ }).click(),
  ]);
  await preview.waitForURL(`${store()}/`);
  await expect(preview.getByRole("heading", { level: 1 })).toHaveText(
    "Suplementos para cada objetivo",
  );
  const energy = preview.getByRole("region", { name: "Para tu energía" });
  await expect(energy.getByRole("heading", { name: "Cafeína anhidra" })).toBeVisible();
  await expect(energy.getByRole("heading", { name: "Creatina monohidratada" })).toHaveCount(0);
  await expectNoSeriousA11yViolations(preview);
  expect(await preview.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual(
    [],
  );
  // Lo que la tienda aún no tiene se marca solo en la vista previa (D-F9-09).
  await preview.goto(`${store()}/productos/cafeina-anhidra`);
  await expect(preview.getByText("Opiniones: pendiente de contenido real")).toBeVisible();
  await expectNoSeriousA11yViolations(preview);
  await preview.close();

  // Publicar: el comprador la ve y "Ver todos" lleva al listado filtrado.
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText("Publicado. Tus clientes ya ven la nueva apariencia.")).toBeVisible();
  await shopper.reload();
  await expect(shopper.getByRole("heading", { level: 1 })).toHaveText(
    "Suplementos para cada objetivo",
  );
  await expect(shopper.getByRole("link", { name: "Ver productos" })).toHaveAttribute(
    "href",
    "/productos",
  );
  await shopper.goto(`${store()}/productos/cafeina-anhidra`);
  await expect(shopper.getByText(/pendiente de contenido real/)).toHaveCount(0);
  await shopper.goto(store());
  await shopper.getByRole("link", { name: "Ver todos de Para tu energía" }).click();
  await expect(shopper).toHaveURL(`${store()}/productos?objetivo=energia`);
  await expect(shopper.getByRole("heading", { name: "Cafeína anhidra" })).toBeVisible();
  await expect(shopper.getByRole("heading", { name: "Creatina monohidratada" })).toHaveCount(0);
  await expectNoSeriousA11yViolations(shopper);
  expect(await shopper.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual(
    [],
  );
  await buyer.close();
});
