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
 * Misión Panel, Paso D: la barra de categorías del encabezado. El primer
 * elemento se ve completo («Todos», no «dos»), todos miden ≥ 44 px, el de la
 * página actual se resalta y se ve, el foco es visible y axe no encuentra
 * nada; la dueña la arma desde Apariencia → Encabezado y pie.
 */
const run = uniq();
const ownerEmail = `barra-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const store = () => `http://${tenant.handle}.localhost:3000`;
const NAMES = ["Energía", "Fuerza", "Recuperación", "Bienestar", "Vitaminas", "Proteínas"];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`nb${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    for (const name of NAMES) {
      await sql`select public.catalog_upsert_category(${tenant.storeId}, ${sql.json({ name })})`;
    }
    await sql`select public.appearance_save_theme_draft(${tenant.storeId}, ${sql.json({
      header: {
        nav_bar: {
          items: [
            { label: "Todos", link: "/productos" },
            ...NAMES.map((name) => ({
              label: name,
              link: `/categoria/${name
                .normalize("NFD")
                .replace(/\p{Diacritic}/gu, "")
                .toLowerCase()}`,
            })),
            { label: "Novedades", link: "/productos?orden=newest" },
          ],
          style: "pills",
          visibility: "all",
        },
      },
    })}, 0)`;
    await sql`select public.appearance_publish_theme(${tenant.storeId}, 1)`;
  });
});

async function checkBar(page: Page, width: number) {
  const bar = page.getByRole("navigation", { name: "Categorías" });
  const first = bar.getByRole("link").first();
  await expect(first).toHaveText("Todos");
  const box = (await first.boundingBox())!;
  // Completo y dentro de la pantalla: empieza en el margen, no cortado.
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  for (const link of await bar.getByRole("link").all()) {
    if (!(await link.isVisible())) continue;
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
}

for (const width of [360, 375, 1280]) {
  test(`barra de categorías a ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(store());
    await checkBar(page, width);
    await expectNoSeriousA11yViolations(page);

    // La página actual se resalta y queda a la vista (centrada si hace falta).
    await page.goto(`${store()}/categoria/bienestar`);
    const bar = page.getByRole("navigation", { name: "Categorías" });
    const current = bar.getByRole("link", { name: "Bienestar" });
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(bar.locator('[aria-current="page"]')).toHaveCount(1);
    const navBox = (await bar.boundingBox())!;
    await expect
      .poll(async () => {
        const b = (await current.boundingBox())!;
        return b.x >= navBox.x && b.x + b.width <= navBox.x + navBox.width;
      })
      .toBe(true);

    // Foco visible con el teclado.
    await bar.getByRole("link").first().focus();
    const outline = await bar
      .getByRole("link")
      .first()
      .evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");

    // Entre enlaces de la misma ruta, el activo sigue a los parámetros al
    // navegar dentro de la tienda (sin recargar).
    await page.goto(`${store()}/productos`);
    await expect(bar.getByRole("link", { name: "Todos" })).toHaveAttribute("aria-current", "page");
    await bar.getByRole("link", { name: "Novedades" }).click();
    await page.waitForURL(/orden=newest/);
    await expect(bar.getByRole("link", { name: "Novedades" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(bar.locator('[aria-current="page"]')).toHaveCount(1);
  });
}

test("la dueña arma la barra desde el panel", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/apariencia?seccion=encabezado`);
  // La base local tiene todas las migraciones: sin aviso (Paso E).
  await expect(page.getByText("Faltan actualizaciones de la base de datos")).toHaveCount(0);
  const list = page.getByRole("list", { name: "Enlaces de la barra" });
  await expect(list.getByRole("listitem")).toHaveCount(8);
  // Quitar «Proteínas», subir «Bienestar» y agregar «Más vendidos».
  await page.getByRole("button", { name: "Quitar Proteínas" }).click();
  await page.getByRole("button", { name: "Subir Bienestar" }).click();
  await page.getByLabel("Agregar a la barra").selectOption({ label: "Más vendidos" });
  await page.getByRole("button", { name: "Agregar", exact: true }).click();
  await page.getByLabel("Estilo").selectOption("photos");
  await page.getByLabel("Fija arriba al bajar por la página").check();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("button", { name: "Guardar en el borrador" }).first().click();
  await expect(
    page.getByRole("status").filter({ hasText: "Guardado en el borrador" }),
  ).toBeVisible();

  const [row] = await admin<
    { nav: { items: { label: string }[]; style: string; sticky: boolean } }[]
  >`
    select draft_settings #> '{header,nav_bar}' as nav from public.store_themes where store_id = ${tenant.storeId}`;
  expect(row!.nav.items.map((i) => i.label)).toEqual([
    "Todos",
    "Energía",
    "Fuerza",
    "Bienestar",
    "Recuperación",
    "Vitaminas",
    "Novedades",
    "Más vendidos",
  ]);
  expect(row!.nav).toMatchObject({ style: "photos", sticky: true });
});
