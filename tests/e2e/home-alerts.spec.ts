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
 * Alertas de Inicio (Orden 10, O10-02): con «Salud de tu tienda» apagada no
 * aparecen; encendida, cada alerta trae su conteo, su urgencia, qué hacer y un
 * enlace a la lista de productos con exactamente esos productos.
 */
const run = uniq();
const ownerEmail = `alertas-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

test.beforeAll(async () => {
  tenant = await createTenant(`al${run}`, await createAuthUser(ownerEmail));
  // Dos productos publicados: uno agotado y sin foto ni categoría; otro con
  // existencias ilimitadas (sin control) pero también sin foto ni categoría.
  for (const [slug, title, track] of [
    ["agotado", "Playera agotada", true],
    ["libre", "Gorra sin control", false],
  ] as const) {
    const [p] = await admin<{ id: string }[]>`
      insert into public.products (store_id, title, slug, status, published_at)
      values (${tenant.storeId}, ${title}, ${slug}, 'active', now()) returning id`;
    await admin`insert into public.product_variants (store_id, product_id, sku, price, option_signature, track_inventory)
                values (${tenant.storeId}, ${p!.id}, ${`AL-${slug}-${run}`}, 10000, '', ${track})`;
  }
});

test("las alertas aparecen con su conteo y llevan a la lista con esos productos", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  const base = `/admin/${tenant.handle}`;
  await page.goto(base);
  await expect(page.getByRole("heading", { name: "Qué atender hoy" })).toHaveCount(0);

  await page.goto(`${base}/ajustes/funciones`);
  await page
    .getByRole("form", { name: "Salud de tu tienda" })
    .getByRole("button", { name: "Encender salud de tu tienda" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Salud de tu tienda: encendida." }),
  ).toBeVisible();

  await page.goto(base);
  const panel = page.getByRole("region", { name: "Qué atender hoy" });
  const items = panel.getByRole("listitem");
  await expect(items).toHaveCount(3);
  // La más urgente primero.
  await expect(items.first()).toContainText("Presentaciones agotadas: 1");
  await expect(items.first()).toContainText("Urgente");
  await expect(panel.getByText("Sin foto: 2")).toBeVisible();
  await expect(panel.getByText("Sin categoría: 2")).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Cada enlace lleva a la lista filtrada con exactamente esos productos.
  await items.first().getByRole("link", { name: "Ver el producto" }).click();
  await expect(page).toHaveURL(/\/productos\?estado=active&pendiente=agotados$/);
  await expect(page.getByRole("link", { name: "Playera agotada" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Gorra sin control" })).toHaveCount(0);

  await page.goto(base);
  await panel
    .getByRole("listitem")
    .filter({ hasText: "Sin categoría" })
    .getByRole("link", { name: "Ver los productos" })
    .click();
  await expect(page).toHaveURL(/pendiente=sin_categoria$/);
  await expect(page.getByRole("link", { name: "Playera agotada" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Gorra sin control" })).toBeVisible();
});
