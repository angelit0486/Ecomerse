import { expect, test, type Page } from "@playwright/test";

import { admin, createAuthUser, createTenant, loginNewStaff, uniq } from "./support";

/**
 * Interruptor mobile_input_size (docs/plan/PRIMER-PEDIDO.md): en el celular, los
 * campos de la tienda y del panel miden 16 px y el iPhone no acerca la página al
 * escribir. Apagado, todo queda como antes; en la computadora no cambia.
 */
test.describe.configure({ mode: "serial" });

const run = uniq();
const ownerEmail = `celular-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const store = () => `http://${tenant.handle}.localhost:3000`;

const setFlag = (enabled: boolean) => admin`
  insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
  values ('mobile_input_size', 'store', ${tenant.storeId}, ${enabled}, 'Prueba E2E de los campos en el celular')
  on conflict (flag_key, scope, scope_id) do update set enabled = excluded.enabled`;

const fontSize = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).fontSize);

test.beforeAll(async () => {
  tenant = await createTenant(`mi${run}`, await createAuthUser(ownerEmail));
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
});

test("tienda: el campo de correo mide 16 px en el celular solo con el interruptor", async ({
  browser,
}) => {
  const phone = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await phone.newPage();
  await page.goto(`${store()}/cuenta`);
  const search = 'input[name="email"]';
  const before = await fontSize(page, search);
  expect(Number.parseFloat(before)).toBeLessThan(16);
  await setFlag(true);
  await page.reload();
  expect(await fontSize(page, search)).toBe("16px");
  await phone.close();

  // En la computadora no cambia.
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const deskPage = await desk.newPage();
  await deskPage.goto(`${store()}/cuenta`);
  expect(await fontSize(deskPage, search)).toBe(before);
  await desk.close();
  await setFlag(false);
});

test("panel: los campos miden 16 px en el celular solo con el interruptor", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/admin/${tenant.handle}/ajustes/tienda`);
  // Marca los campos que hoy miden menos de 16 px.
  const small = await page.evaluate(
    () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea",
        ),
      ]
        .filter((e) => e.offsetParent && Number.parseFloat(getComputedStyle(e).fontSize) < 16)
        .map((e, i) => (e.dataset.small = String(i))).length,
  );
  expect(small).toBeGreaterThan(0);
  const sizes = () =>
    page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea",
        ),
      ]
        .filter((e) => e.offsetParent)
        .map((e) => getComputedStyle(e).fontSize),
    );
  await setFlag(true);
  await page.reload();
  expect(new Set(await sizes())).toEqual(new Set(["16px"]));
  await setFlag(false);
  await page.reload();
  expect((await sizes()).some((f) => Number.parseFloat(f) < 16)).toBe(true);
});
