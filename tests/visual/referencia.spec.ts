import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { createAuthUser, createTenant, loginNewStaff, uniq } from "../e2e/support";

/**
 * Capturas de referencia de la tienda de demostración (`pnpm demo:seed`) y del
 * panel. Sin animaciones; página completa. El panel usa una tienda nueva, así
 * que su nombre cambia entre corridas (diferencia esperada).
 */
const OUT = process.env.VISUAL_OUT ?? "docs/audit/referencia";
const STORE = process.env.VISUAL_STORE ?? "http://demo.localhost:3000";
const WIDTHS = [375, 1280] as const;

async function shot(page: Page, name: string, width: number) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({
    path: `${OUT}/${name}-${width}.png`,
    fullPage: true,
    animations: "disabled",
  });
}

for (const width of WIDTHS) {
  test(`tienda de demostración a ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 812 : 900 });
    await page.goto(`${STORE}/`);
    await shot(page, "portada", width);

    await page.goto(`${STORE}/productos`);
    await shot(page, "listado", width);

    const first = page.locator('a[href*="/productos/"]').first();
    const href = await first.getAttribute("href");
    expect(href).toBeTruthy();
    await page.goto(new URL(href!, STORE).toString());
    await shot(page, "ficha", width);

    await page
      .getByRole("button", { name: /agregar al carrito/i })
      .first()
      .click();
    await page.waitForTimeout(500);
    await page.goto(`${STORE}/carrito`);
    await shot(page, "carrito", width);

    await page.goto(`${STORE}/checkout`);
    await shot(page, "checkout", width);
  });

  test(`panel a ${width} px`, async ({ page }) => {
    const email = `referencia-${uniq()}@example.test`;
    const tenant = await createTenant(`ref${uniq()}`, await createAuthUser(email));
    await loginNewStaff(page, email);
    await page.setViewportSize({ width, height: width < 600 ? 812 : 900 });
    await page.goto(`/admin/${tenant.handle}`);
    await shot(page, "panel", width);
  });
}
