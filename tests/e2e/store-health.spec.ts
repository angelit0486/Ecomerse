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
 * «Salud de tu tienda» (auditoría global, paso 19; interruptor store_health):
 * apagada no aparece; la dueña la enciende en Ajustes → Funciones; muestra lo
 * urgente primero, con el enlace a dónde se arregla, y se actualiza al resolverlo.
 */
const run = uniq();
const ownerEmail = `salud-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`sl${run}`, ownerId);
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${tenant.storeId}, 'Taza sin foto', 'taza', 'active', now()) returning id`;
  await admin`insert into public.product_variants (store_id, product_id, sku, price, option_signature, track_inventory)
              values (${tenant.storeId}, ${p!.id}, ${`SL-${run}`}, 10000, '', false)`;
});

test("salud de la tienda: apagada no aparece; urgente primero; se actualiza al resolver", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  const base = `/admin/${tenant.handle}`;
  await page.goto(base);
  await expect(page.getByRole("link", { name: "Salud", exact: true })).toHaveCount(0);
  expect((await page.goto(`${base}/salud`))?.status()).toBe(404);

  await page.goto(`${base}/ajustes/funciones`);
  await page
    .getByRole("form", { name: "Salud de tu tienda" })
    .getByRole("button", { name: "Encender salud de tu tienda" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Salud de tu tienda: encendida." }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Salud", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Salud de tu tienda" })).toBeVisible();
  const checks = page.getByRole("list", { name: "Revisiones" }).getByRole("listitem");
  // Lo urgente va primero.
  await expect(checks.first()).toContainText("Urgente:");
  const payments = checks.filter({ hasText: "No tienes ninguna forma de pago activa" });
  await expect(payments).toBeVisible();
  await expect(payments.getByRole("link", { name: "Revisar pagos" })).toHaveAttribute(
    "href",
    `${base}/ajustes/pagos`,
  );
  const photos = checks.filter({ hasText: "1 producto sin foto" });
  await expect(photos.getByRole("link", { name: "Ver productos sin foto" })).toHaveAttribute(
    "href",
    `${base}/productos?pendiente=sin_foto`,
  );
  await expect(checks.filter({ hasText: "Faltan políticas por publicar" })).toContainText(
    "El aviso de privacidad es obligatorio por ley.",
  );
  await expectNoSeriousA11yViolations(page);

  // Se resuelve el pago: la revisión cambia al volver a cargar.
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
              values (${tenant.storeId}, 'manual', 'active', 'Transferencia', '{"instructions":"CLABE 0123456789"}')`;
  await page.reload();
  await expect(checks.filter({ hasText: "Solo aceptas pagos manuales" })).toBeVisible();
  await expect(checks.filter({ hasText: "No tienes ninguna forma de pago activa" })).toHaveCount(0);
});
