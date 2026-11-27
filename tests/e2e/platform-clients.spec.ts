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
 * Consola → «Mis clientes»: la plataforma ve el semáforo de cada tienda y, arriba,
 * las que necesitan ayuda hoy con el motivo. Solo dueña y administración (trae
 * ventas de todas las tiendas): soporte recibe 404 y no ve el enlace.
 */
const run = uniq();
const adminEmail = `padmin-cl-${run}@platform.test`;
const supportEmail = `psoporte-cl-${run}@platform.test`;
let withProblem: Awaited<ReturnType<typeof createTenant>>;
let calm: Awaited<ReturnType<typeof createTenant>>;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const adminId = await createAuthUser(adminEmail);
  const supportId = await createAuthUser(supportEmail);
  await admin`insert into public.platform_staff (user_id, role)
              values (${adminId}, 'platform_admin'), (${supportId}, 'platform_support')`;
  withProblem = await createTenant(`cla${run}`, await createAuthUser(`a-cl-${run}@example.test`));
  calm = await createTenant(`clb${run}`, await createAuthUser(`b-cl-${run}@example.test`));
  // Tienda A: una transferencia que la tienda no confirmó en 2 días.
  await admin`
    insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                               requires_shipping, currency, prices_include_tax, tax_rate_bps,
                               tax_applies_to_shipping, subtotal, discount_total, shipping_total, tax_total,
                               total, placed_at, created_at)
    values (${withProblem.storeId}, 7001, '#7001', ${`idem-cl-${run}`}, ${`c-cl-${run}@example.test`}, 'Cliente',
            false, 'MXN', true, 1600, true, 10000, 0, 0, 0, 10000,
            now() - interval '2 days', now() - interval '2 days')`;
});

test("la administración ve quién necesita ayuda hoy y por qué", async ({ page }) => {
  await loginNewStaff(page, adminEmail);
  await page.goto("/platform");
  await page
    .getByRole("navigation", { name: "Consola de plataforma" })
    .getByRole("link", { name: "Mis clientes" })
    .click();
  await expect(page.getByRole("heading", { name: "Mis clientes", level: 1 })).toBeVisible();
  // Con muchas tiendas se busca por nombre.
  const search = page.getByLabel("Buscar tienda u organización");
  await search.fill(withProblem.name);
  await search.press("Enter");
  await expect(page).toHaveURL(
    new RegExp(`/platform/clientes\\?q=${withProblem.name.replace(" ", "\\+")}$`),
  );

  const help = page.getByRole("region", { name: "Necesitan ayuda hoy" });
  const item = help.getByRole("listitem").filter({ hasText: withProblem.name }).first();
  await expect(item).toContainText("Atender hoy");
  await expect(item).toContainText("1 transferencia sin confirmar desde hace más de 24 h");
  await expect(
    item.getByRole("link", { name: `Ver la organización de ${withProblem.name}` }),
  ).toHaveAttribute("href", `/platform/organizaciones/${withProblem.orgId}`);

  // La otra tienda aparece en la tabla con su propio estado, sin el motivo de A.
  await search.fill(calm.name);
  await search.press("Enter");
  const row = page.getByRole("row").filter({ hasText: calm.name });
  await expect(row).toBeVisible();
  await expect(help.getByRole("listitem").filter({ hasText: calm.name })).not.toContainText(
    "transferencia",
  );

  await expectNoSeriousA11yViolations(page);
});

test("soporte no ve «Mis clientes»: no está en el menú y la página da 404", async ({ page }) => {
  await loginNewStaff(page, supportEmail);
  await page.goto("/platform");
  await expect(
    page.getByRole("navigation", { name: "Consola de plataforma" }).getByRole("link", {
      name: "Mis clientes",
    }),
  ).toHaveCount(0);
  expect((await page.goto("/platform/clientes"))?.status()).toBe(404);
});
