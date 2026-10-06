import { expect, test, type Page } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/**
 * F5-T03: tienda pública en dos hosts — catálogo, ficha con selector de
 * variantes, categoría, marca, búsqueda, páginas, 404 y 503 — sin mezcla de
 * datos entre tiendas; axe y capturas a 375 y 1280 px.
 */
const run = uniq();
let a: Awaited<ReturnType<typeof createTenant>>;
let b: Awaited<ReturnType<typeof createTenant>>;
const origin = (t: { handle: string }) => `http://${t.handle}.localhost:3000`;

/** Ejecuta RPC del catálogo como el dueño con 2FA (claims del JWT en la transacción). */
async function asOwner<T>(ownerId: string, work: (sql: typeof admin) => Promise<T>): Promise<T> {
  return (await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    return work(sql as unknown as typeof admin);
  })) as T;
}

async function seed(
  tenant: Awaited<ReturnType<typeof createTenant>>,
  ownerId: string,
  prefix: string,
) {
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await asOwner(ownerId, async (sql) => {
    const [cat] = await sql<{ id: string }[]>`
      select public.catalog_upsert_category(${tenant.storeId}, ${sql.json({ name: "Ropa" })}) as id`;
    const [brand] = await sql<{ id: string }[]>`
      select public.catalog_upsert_brand(${tenant.storeId}, ${sql.json({ name: `Marca ${prefix}` })}) as id`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: `Playera ${prefix} de algodón`,
        brand_id: brand!.id,
        description_html: "<p>Algodón suave.</p><script>alert(1)</script>",
        categories: [{ id: cat!.id, is_primary: true }],
        options: [{ name: "Talla", values: ["CH", "M"] }],
        variants: [
          { options: { Talla: "CH" }, price: 19900, sku: `${prefix}-CH-${run}` },
          { options: { Talla: "M" }, price: 21900, sku: `${prefix}-M-${run}` },
        ],
      })}) as r`;
    const [chId] = await sql<{ id: string }[]>`
      select id from public.product_variants where sku = ${`${prefix}-CH-${run}`.toUpperCase()}`;
    await sql`select public.inventory_adjust(${tenant.storeId}, ${chId!.id}, 'adjustment', 10, 'Inicial')`;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
    await sql`select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
      title: `Borrador ${prefix}`,
      variants: [{ price: 100 }],
    })})`;
  });
  await admin`update public.store_pages set is_published = true, published_at = now()
              where store_id = ${tenant.storeId} and type = 'policy_shipping'`;
}

test.beforeAll(async () => {
  const ownerA = await createAuthUser(`sf-a-${run}@example.test`);
  const ownerB = await createAuthUser(`sf-b-${run}@example.test`);
  a = await createTenant(`sa${run}`, ownerA);
  b = await createTenant(`sb${run}`, ownerB);
  await seed(a, ownerA, "A");
  await seed(b, ownerB, "B");
});

async function shots(page: Page, name: string) {
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`), fullPage: true });
  }
}

test("dos tiendas en dos hosts: catálogo, ficha, categoría, marca, búsqueda y páginas sin mezcla", async ({
  page,
}) => {
  // Inicio de A: solo lo publicado de A.
  await page.goto(`${origin(a)}/`);
  await expect(page.getByRole("heading", { level: 1, name: a.name })).toBeVisible();
  await expect(page.getByRole("link", { name: "Playera A de algodón" })).toBeVisible();
  await expect(page.getByText("Playera B de algodón")).toHaveCount(0);
  await expect(page.getByText("Borrador A")).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);
  await shots(page, "inicio");

  // Ficha con selector de variantes.
  await page.getByRole("link", { name: "Playera A de algodón" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Playera A de algodón" })).toBeVisible();
  await expect(page.getByText("Algodón suave.")).toBeVisible();
  await expect(page.locator("script", { hasText: "alert(1)" })).toHaveCount(0);
  await expect(page.getByText("$199.00")).toBeVisible();
  await expect(page.getByText("Disponible", { exact: true })).toBeVisible();
  await page.getByText("M", { exact: true }).click();
  await expect(page.getByText("$219.00")).toBeVisible();
  await expect(page.getByRole("paragraph").filter({ hasText: /^Agotado$/ })).toBeVisible();
  // Una variante agotada no se puede agregar al carrito (F6).
  await expect(page.getByRole("button", { name: "Agotado" })).toBeDisabled();
  await expect(page.getByRole("navigation", { name: "Ruta de navegación" })).toContainText("Ropa");
  await expectNoSeriousA11yViolations(page);
  await shots(page, "producto");

  // Categoría y marca.
  await page.goto(`${origin(a)}/categoria/ropa`);
  await expect(page.getByRole("heading", { level: 1, name: "Ropa" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Playera A de algodón" })).toBeVisible();
  await page.goto(`${origin(a)}/marca/marca-a`);
  await expect(page.getByRole("link", { name: "Playera A de algodón" })).toBeVisible();
  await page.goto(`${origin(a)}/marca/marca-b`);
  await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();

  // Búsqueda sin acentos; nunca devuelve productos de B.
  await page.goto(`${origin(a)}/`);
  await page.getByRole("searchbox", { name: "Buscar productos" }).fill("algodon");
  await page.getByRole("button", { name: "Buscar" }).click();
  await expect(page.getByRole("heading", { name: "Resultados para «algodon»" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Playera A de algodón" })).toBeVisible();
  await expect(page.getByText("Playera B de algodón")).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);

  // Páginas: publicada sí, borrador no.
  await page.goto(`${origin(a)}/paginas/envios`);
  await expect(page.getByRole("heading", { level: 1, name: "Envíos" })).toBeVisible();
  await page.goto(`${origin(a)}/paginas/aviso-de-privacidad`);
  await expect(page.getByRole("heading", { name: "No encontramos esta página" })).toBeVisible();

  // Un producto de A no existe en el host de B.
  const slugA = "playera-a-de-algodon";
  const onB = await page.goto(`${origin(b)}/productos/${slugA}`);
  expect(onB?.status()).toBe(404);
  await page.goto(`${origin(b)}/productos`);
  await expect(page.getByRole("link", { name: "Playera B de algodón" })).toBeVisible();
  await expect(page.getByText("Playera A de algodón")).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);
  await shots(page, "listado");
});

test("caché por tienda: un cambio en el panel se ve al instante en la tienda (invalidación por tag)", async ({
  page,
}) => {
  // Calienta la caché de datos de A y de B.
  await page.goto(`${origin(a)}/productos`);
  await expect(page.getByRole("link", { name: "Playera A de algodón" })).toBeVisible();
  await page.goto(`${origin(b)}/productos`);
  await expect(page.getByRole("link", { name: "Playera B de algodón" })).toBeVisible();

  await loginNewStaff(page, `sf-a-${run}@example.test`);
  await page.goto(`/admin/${a.handle}/productos`);
  await page.getByRole("link", { name: "Playera A de algodón" }).click();
  await page.getByRole("textbox", { name: "Título", exact: true }).fill("Playera A renovada");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cambios guardados." })).toBeVisible();

  // Sin esperar el TTL de 60 s: la invalidación por tag lo hace visible ya.
  await page.goto(`${origin(a)}/productos`);
  await expect(page.getByRole("link", { name: "Playera A renovada" })).toBeVisible();
  // B no cambia ni recibe nada de A.
  await page.goto(`${origin(b)}/productos`);
  await expect(page.getByRole("link", { name: "Playera B de algodón" })).toBeVisible();
  await expect(page.getByText("Playera A renovada")).toHaveCount(0);
});

test("SEO por host: canonical al primario, JSON-LD válido, sitemap y robots sin cruzar tiendas", async ({
  page,
}) => {
  await page.goto(`${origin(a)}/productos/playera-a-de-algodon`);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${origin(a)}/productos/playera-a-de-algodon`,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute("content", a.name);
  const ld = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent())!,
  ) as {
    "@graph": Array<Record<string, unknown>>;
  };
  const product = ld["@graph"].find((n) => n["@type"] === "Product")!;
  expect(product).toMatchObject({
    name: "Playera A renovada", // renombrada en la prueba de invalidación

    brand: { "@type": "Brand", name: "Marca A" },
    offers: {
      "@type": "AggregateOffer",
      lowPrice: "199.00",
      highPrice: "219.00",
      priceCurrency: "MXN",
    },
  });
  expect(product.aggregateRating).toBeUndefined(); // nunca valoraciones sin reseñas reales
  const crumbs = ld["@graph"].find((n) => n["@type"] === "BreadcrumbList") as {
    itemListElement: { name: string; item: string }[];
  };
  expect(crumbs.itemListElement.map((c) => c.name)).toEqual(["Ropa", "Playera A renovada"]);

  await page.goto(`${origin(a)}/`);
  const home = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent())!,
  ) as {
    "@graph": Array<Record<string, unknown>>;
  };
  expect(home["@graph"].map((n) => n["@type"])).toEqual(["OnlineStore", "WebSite"]);

  await page.goto(`${origin(a)}/buscar?q=algodon`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  const sitemapA = await (await page.goto(`${origin(a)}/sitemap.xml`))!.text();
  expect(sitemapA).toContain(`<loc>${origin(a)}/productos/playera-a-de-algodon</loc>`);
  expect(sitemapA).toContain(`<loc>${origin(a)}/paginas/envios</loc>`);
  expect(sitemapA).not.toContain("playera-b");
  expect(sitemapA).not.toContain("aviso-de-privacidad");
  expect(sitemapA).not.toContain(origin(b));

  const robotsA = await (await page.goto(`${origin(a)}/robots.txt`))!.text();
  expect(robotsA).toContain("Disallow: /checkout");
  expect(robotsA).toContain(`Sitemap: ${origin(a)}/sitemap.xml`);
  const robotsB = await (await page.goto(`${origin(b)}/robots.txt`))!.text();
  expect(robotsB).toContain(`Sitemap: ${origin(b)}/sitemap.xml`);
});

test("host desconocido → 404 uniforme; tienda suspendida → 503", async ({ page }) => {
  const unknown = await page.goto(`http://no-existe-${run}.localhost:3000/`);
  expect(unknown?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Tienda no disponible" })).toBeVisible();

  await admin`update public.stores set status = 'suspended' where id = ${b.storeId}`;
  try {
    // La resolución de host se cachea hasta 60 s por instancia (§21.1).
    await expect
      .poll(async () => (await page.goto(`${origin(b)}/`))?.status(), {
        timeout: 75_000,
        intervals: [2000],
      })
      .toBe(503);
    await expect(page.getByRole("heading", { name: "Tienda en mantenimiento" })).toBeVisible();
  } finally {
    await admin`update public.stores set status = 'active' where id = ${b.storeId}`;
  }
});
