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
 * ADR-026: contenido neto y porciones por presentación. La ficha muestra el
 * precio por porción del tamaño elegido; el editor los captura por variante.
 */
const run = uniq();
const ownerEmail = `porciones-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let productId = "";
const origin = () => `http://${tenant.handle}.localhost:3000`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`vs${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() - interval '60 days' where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Proteína whey",
        slug: "whey",
        options: [{ name: "Tamaño", values: ["1 kg", "2 kg"] }],
        variants: [
          {
            price: 66000,
            sku: `W1-${run}`,
            options: { Tamaño: "1 kg" },
            net_content: "1 kg",
            servings_per_container: 33,
            inventory_policy: "continue",
          },
          {
            price: 118800,
            sku: `W2-${run}`,
            options: { Tamaño: "2 kg" },
            net_content: "2 kg",
            servings_per_container: 66,
            inventory_policy: "continue",
          },
        ],
      })}) as r`;
    productId = p!.r.id;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${productId})`;
  });
});

test("la ficha muestra contenido y precio por porción del tamaño elegido", async ({ page }) => {
  await page.goto(`${origin()}/productos/whey`);
  await expect(page.getByText("1 kg · $20.00 por porción (33 porciones)")).toBeVisible();
  await page.getByText("2 kg", { exact: true }).click();
  await expect(page.getByText("2 kg · $18.00 por porción (66 porciones)")).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test("el editor captura contenido y porciones por variante", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/${productId}`);
  await expect(page.getByLabel("Contenido neto de 2 kg")).toHaveValue("2 kg");
  await expect(page.getByLabel("Porciones de 2 kg")).toHaveValue("66");
  await page.getByLabel("Porciones de 2 kg").fill("0");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText(/Porciones no válidas en 2 kg/)).toBeVisible();
});
