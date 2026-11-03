import { mkdirSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "../e2e/support";

/**
 * Lote 2 (misión de mejoras): barra de categorías, «Buscar marca» y aviso de
 * vista previa en el celular. Tienda en borrador con 10 marcas y 6 categorías,
 * vista previa a 375 px: capturas, medidas y axe. Mismas capturas antes y
 * después de cada cambio (VISUAL_OUT).
 */
const OUT = process.env.VISUAL_OUT ?? "docs/audit/lote2";

test("barra, marcas y aviso de vista previa a 375 px", async ({ page, context }) => {
  mkdirSync(OUT, { recursive: true });
  const run = uniq();
  const email = `lote2-${run}@example.test`;
  const tenant = await createTenant(`l2${run}`, await createAuthUser(email));
  const cats = ["Proteínas", "Creatinas", "Pre-entrenos", "Vitaminas", "Snacks", "Accesorios"];
  for (const [i, name] of cats.entries()) {
    await admin`insert into public.categories (store_id, name, slug, position)
                values (${tenant.storeId}, ${name}, ${`cat-${i}`}, ${i})`;
  }
  for (let i = 0; i < 10; i += 1) {
    const [b] = await admin<{ id: string }[]>`
      insert into public.brands (store_id, name, slug)
      values (${tenant.storeId}, ${`Marca ${String.fromCharCode(65 + i)}`}, ${`marca-${i}`}) returning id`;
    const [p] = await admin<{ id: string }[]>`
      insert into public.products (store_id, title, slug, status, published_at, brand_id)
      values (${tenant.storeId}, ${`Producto ${i}`}, ${`producto-${i}`}, 'active', now(), ${b!.id}) returning id`;
    await admin`insert into public.product_variants (store_id, product_id, sku, price, option_signature)
                values (${tenant.storeId}, ${p!.id}, ${`L2-${run}-${i}`.toUpperCase()}, 19900, '')`;
  }

  await loginNewStaff(page, email);
  await page.goto(`/admin/${tenant.handle}/configuracion`);
  const [preview] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "Ver vista previa de la tienda" }).click(),
  ]);
  await preview.waitForURL(/^https?:\/\//);
  await preview.setViewportSize({ width: 375, height: 812 });
  await preview.reload();
  await preview.waitForLoadState("networkidle");
  await preview.screenshot({ path: `${OUT}/vista-previa-375.png`, animations: "disabled" });

  // Aviso de vista previa: alto y botón «Salir de la vista previa».
  const banner = preview
    .getByRole("status")
    .filter({ hasText: /Vista previa/ })
    .first();
  const bannerBox = await banner.boundingBox();
  const exit = preview.getByRole("button", { name: "Salir de la vista previa" });
  await expect(exit).toBeVisible();
  const exitBox = await exit.boundingBox();

  // Barra de categorías: el primer enlace empieza dentro de la pantalla y se lee completo.
  const nav = preview.getByRole("navigation", { name: "Categorías" });
  const firstLink = nav.getByRole("link").first();
  const first = await firstLink.boundingBox();
  const firstText = await firstLink.innerText();
  const navLinks = await nav.getByRole("link").all();
  const heights = await Promise.all(
    navLinks.map(async (l) => (await l.boundingBox())?.height ?? 0),
  );

  await expectNoSeriousA11yViolations(preview);

  const origin = new URL(preview.url()).origin;
  await preview.goto(`${origin}/marcas`);
  await preview.waitForLoadState("networkidle");
  const search = preview.getByLabel("Buscar marca");
  await expect(search).toBeVisible();
  const placeholder = await search.getAttribute("placeholder");
  const searchBox = await search.boundingBox();
  await preview.screenshot({ path: `${OUT}/marcas-375.png`, animations: "disabled" });
  await expectNoSeriousA11yViolations(preview);

  // Borde izquierdo de la barra en /marcas (activo a la derecha): ¿algún enlace cortado?
  const firstVisibleCut = async () =>
    preview.evaluate(() => {
      const ul = document.querySelector('nav[aria-label="Categorías"] ul');
      if (!ul) return null;
      // Se mide el texto (no el <li>, que tiene relleno): px ocultos de la primera palabra visible.
      const left = ul.getBoundingClientRect().left;
      const texts = Array.from(ul.querySelectorAll("li a span:last-child"));
      const visible = texts.find((t) => t.getBoundingClientRect().right > left + 1);
      return visible ? Math.round(left - visible.getBoundingClientRect().left) : null;
    });
  const cutOff = await firstVisibleCut();
  await preview
    .locator('nav[aria-label="Categorías"]')
    .screenshot({ path: `${OUT}/barra-marcas-flag-apagado-375.png` });

  // Interruptor encendido solo para esta tienda.
  await admin`insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
              values ('storefront_nav_scroll_fix', 'store', ${tenant.storeId}, true, 'Prueba visual del lote 2')`;
  await preview.reload();
  await preview.waitForLoadState("networkidle");
  await preview.waitForTimeout(300);
  const cutOn = await firstVisibleCut();
  await preview
    .locator('nav[aria-label="Categorías"]')
    .screenshot({ path: `${OUT}/barra-marcas-flag-encendido-375.png` });
  await expect(
    preview.getByRole("navigation", { name: "Categorías" }).getByRole("link", { name: "Marcas" }),
  ).toBeInViewport({ ratio: 1 });
  await expectNoSeriousA11yViolations(preview);

  const report = {
    cut: { flagOff: cutOff, flagOn: cutOn },
    banner: { height: bannerBox?.height, exitHeight: exitBox?.height },
    nav: { firstText, firstX: first?.x, firstWidth: first?.width, minHeight: Math.min(...heights) },
    brandSearch: { placeholder, height: searchBox?.height },
  };
  console.log(`LOTE2 ${JSON.stringify(report)}`);
  expect(first!.x).toBeGreaterThanOrEqual(0);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  expect(exitBox!.height).toBeGreaterThanOrEqual(44);
  expect(searchBox!.height).toBeGreaterThanOrEqual(44);
  expect(placeholder).toBeTruthy();
  // Con el interruptor encendido, el primer enlace visible empieza en el borde (0 px cortados).
  expect(cutOn).toBeLessThanOrEqual(0);
});
