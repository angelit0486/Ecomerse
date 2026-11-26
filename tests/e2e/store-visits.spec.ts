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
 * Visitantes de la tienda (20261126000200): una persona cuenta una vez al día
 * por tienda, sin cookies; un navegador automático no cuenta; la dueña lo ve en
 * el Inicio de su panel con la nota de desde cuándo se cuenta.
 */
const run = uniq();
const ownerEmail = `visitas-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const origin = () => `http://${tenant.handle}.localhost:3000`;
// Un navegador normal de celular.
const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";

const visitors = async () =>
  (
    await admin<{ n: number }[]>`
      select coalesce(sum(visitors), 0)::int as n from public.store_visits_daily
       where store_id = ${tenant.storeId}`
  )[0]!.n;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  tenant = await createTenant(`vi${run}`, await createAuthUser(ownerEmail));
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
});

test("una persona cuenta una vez al día; un navegador automático no cuenta", async ({
  browser,
}) => {
  // Una persona: navegador de celular normal, sin la marca de automatización.
  const person = await browser.newContext({ userAgent: PHONE_UA });
  await person.addInitScript(() =>
    Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }),
  );
  const page = await person.newPage();
  await page.goto(`${origin()}/`);
  await expect.poll(visitors, { timeout: 10_000 }).toBe(1);

  // Vuelve el mismo día y ve otra página: sigue contando como una.
  await page.goto(`${origin()}/productos`);
  await page.waitForTimeout(1_500);
  expect(await visitors()).toBe(1);
  await person.close();

  // Un navegador automatizado (navigator.webdriver) no suma, aunque su
  // user-agent sea el de un Chrome normal de escritorio.
  const robot = await browser.newContext();
  const bot = await robot.newPage();
  await bot.goto(`${origin()}/`);
  await bot.waitForTimeout(1_500);
  expect(await visitors()).toBe(1);
  await robot.close();
});

test("la dueña ve sus visitantes en el Inicio del panel", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  const card = page.getByRole("region", { name: "Visitantes del periodo" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Visitantes", { exact: true })).toBeVisible();
  await expect(card.locator("dd").first()).toHaveText("1");
  // El conteo empezó hoy, a mitad del periodo: lo dice y no inventa la conversión.
  await expect(card).toContainText("Contando desde el");
  await expect(card).toContainText("Se calcula con un periodo completo de conteo");
  await expectNoSeriousA11yViolations(page);
});
