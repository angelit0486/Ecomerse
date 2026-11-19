import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  uniq,
} from "./support";

/**
 * Tema de presentación «Nocturno» (looks.ts): se enciende solo con la clave de
 * tema `nocturno`. Dos tiendas en la misma base: la que conserva la clave `base`
 * se ve exactamente como antes; la otra se dibuja oscura, sin desbordar en
 * ningún ancho y sin violaciones serias de accesibilidad.
 */
const run = uniq();
let base: Awaited<ReturnType<typeof createTenant>>;
let nocturno: Awaited<ReturnType<typeof createTenant>>;

const url = (t: { handle: string }, path = "/") => `http://${t.handle}.localhost:3000${path}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(`look-${run}@example.test`);
  base = await createTenant(`lb${run}`, ownerId);
  nocturno = await createTenant(`ln${run}`, ownerId);
  for (const t of [base, nocturno]) {
    await admin`update public.stores set status = 'active', launched_at = now() where id = ${t.storeId}`;
    await admin.begin(async (sql) => {
      await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
      await sql`set local role authenticated`;
      for (const title of ["Estuche (DEMO)", "Gorra (DEMO)", "Taza (DEMO)", "Póster (DEMO)"]) {
        const sku = `${title.slice(0, 3).toUpperCase()}-${t.handle}`;
        const [p] = await sql<{ r: { id: string } }[]>`
          select public.catalog_upsert_product(${t.storeId},
            ${sql.json({ title, variants: [{ price: 49900, sku }] })}) as r`;
        const [v] = await sql<{ id: string }[]>`
          select id from public.product_variants where store_id = ${t.storeId} and sku = ${sku.toUpperCase()}`;
        await sql`select public.inventory_adjust(${t.storeId}, ${v!.id}, 'adjustment', 5, 'Inicial')`;
        await sql`select public.catalog_publish_product(${t.storeId}, ${p!.r.id})`;
      }
    });
  }
  // Antes de la primera visita (la lectura pública de la tienda se guarda en caché).
  await admin`update public.store_themes set theme_key = 'nocturno' where store_id = ${nocturno.storeId}`;
});

test("la clave «base» no cambia nada; «nocturno» enciende el tema solo en su tienda", async ({
  page,
}) => {
  await page.goto(url(base, "/productos"));
  const plain = page.locator(".sf-root");
  await expect(plain).not.toHaveAttribute("data-look", /.*/);
  expect(await plain.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    "rgb(255, 255, 255)",
  );

  await page.goto(url(nocturno, "/productos"));
  const dark = page.locator(".sf-root");
  await expect(dark).toHaveAttribute("data-look", "nocturno");
  expect(await dark.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(9, 9, 13)");
  // Títulos en Space Grotesk y texto en Inter (fuentes autoalojadas de la lista curada).
  const fonts = await page.evaluate(() => ({
    heading: getComputedStyle(document.querySelector("h1")!).fontFamily,
    body: getComputedStyle(document.querySelector(".sf-root")!).fontFamily,
  }));
  expect(fonts.heading).toMatch(/barlow ?condensed/i);
  expect(fonts.body).toMatch(/manrope/i);
  await expect(page.getByRole("link", { name: "Estuche (DEMO)" })).toBeVisible();
  // Los datos son los de la tienda: precio real y botón de compra intactos.
  await expect(page.getByText("$499.00").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Agregar Estuche \(DEMO\) al carrito/ }),
  ).toBeVisible();
});

for (const width of [360, 390, 430, 768, 1024, 1440]) {
  test(`nocturno a ${width} px: sin desbordamiento ni violaciones serias`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/productos"]) {
      await page.goto(url(nocturno, path));
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${path} desborda ${overflow}px`).toBeLessThanOrEqual(0);
    }
    if (width === 390 || width === 1440) await expectNoSeriousA11yViolations(page);
  });
}

test("nocturno: el menú del celular cubre toda la pantalla", async ({ page }) => {
  // Un filtro en el encabezado volvía a éste el contenedor del menú «fixed».
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url(nocturno, "/"));
  await page.getByRole("button", { name: "Menú" }).click();
  const menu = page.getByRole("dialog", { name: "Menú" });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(840);
  expect(box?.y ?? 1).toBe(0);
});

test("nocturno respeta «reducir movimiento»: nada se anima", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(url(nocturno, "/"));
  const animated = await page.evaluate(
    () =>
      [...document.querySelectorAll(".sf-root *")].filter(
        (el) => getComputedStyle(el).animationName !== "none",
      ).length,
  );
  expect(animated).toBe(0);
  await context.close();
});
