import { mkdirSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/**
 * Misión vendible F2: las 6 plantillas por giro se ven completas el primer día,
 * sin fotos («Anaquel ilustrado»), a 360, 375, 768, 1280 y 1920 px: sin
 * desborde horizontal, con los objetos del giro en el hero, el buscador con el
 * nombre de la tienda y sin problemas graves de accesibilidad.
 * Con CAPTURE_DIR guarda capturas para docs/design.
 */
const VERTICALS = ["Suplementos", "Ropa", "Belleza", "Abarrotes", "Hogar y decoración", "Mascotas"];
const WIDTHS = [360, 375, 768, 1280, 1920];
const OUT = process.env.CAPTURE_DIR;

for (const name of VERTICALS) {
  test(`plantilla ${name}: completa y sin desbordes de 360 a 1920 px`, async ({ page }) => {
    test.setTimeout(180_000);
    const run = uniq();
    const email = `diseno-${run}@example.test`;
    const tenant = await createTenant(`d${run}`, await createAuthUser(email));
    await loginNewStaff(page, email);
    await page.goto(`/admin/${tenant.handle}/configuracion`);
    const section = page.getByRole("region", { name: "Plantilla por giro" });
    await section.getByRole("radio", { name: new RegExp(`^${name}`) }).check();
    await section.getByRole("button", { name: "Aplicar plantilla" }).click();
    await section.getByRole("button", { name: "Sí, aplicar" }).click();
    await expect(page.getByText(/aplicada al borrador/)).toBeVisible();
    const [preview] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("link", { name: "Ver vista previa de la tienda" }).click(),
    ]);
    const home = new URL("/", preview.url()).toString();
    const dir = OUT ? `${OUT}/${name.split(" ")[0]!.toLowerCase()}` : null;
    if (dir) mkdirSync(dir, { recursive: true });

    for (const width of WIDTHS) {
      await preview.setViewportSize({ width, height: width < 768 ? 812 : 900 });
      await preview.goto(home);
      await expect(preview.getByRole("heading", { level: 1 })).toBeVisible();
      // Sin foto en el hero: los objetos del giro sobre la repisa.
      await expect(preview.locator(".sf-goods-shelf svg").first()).toBeVisible();
      await expect(preview.getByRole("combobox").first()).toHaveAttribute(
        "placeholder",
        `Buscar en ${tenant.name}`,
      );
      expect(
        await preview.evaluate(() => document.documentElement.scrollWidth),
        `${name} a ${width}px`,
      ).toBeLessThanOrEqual(width);
      await expectNoSeriousA11yViolations(preview);
      if (dir) await preview.screenshot({ path: `${dir}/portada-${width}.png`, fullPage: true });
    }

    // La ficha de un producto de ejemplo, sin foto, también se ve completa.
    await preview.setViewportSize({ width: 375, height: 812 });
    await preview.goto(new URL("/productos", preview.url()).toString());
    await preview.getByRole("article").first().getByRole("link").first().click();
    await expect(preview.getByRole("heading", { level: 1 })).toContainText("Ejemplo · ");
    // La ruta de navegación, aunque ocupe dos líneas, no queda debajo de la foto.
    const crumb = preview
      .getByRole("navigation", { name: "Ruta de navegación" })
      .locator('[aria-current="page"]');
    expect(
      await crumb.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + 4, r.top + r.height / 2);
        return hit === el || el.contains(hit);
      }),
    ).toBe(true);
    expect(await preview.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      375,
    );
    await expectNoSeriousA11yViolations(preview);
    if (dir) await preview.screenshot({ path: `${dir}/ficha-375.png`, fullPage: true });
  });
}
