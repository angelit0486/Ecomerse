import { expect, test } from "@playwright/test";

import { admin, createAuthUser, createTenant, uniq } from "./support";

/**
 * Precio consistente entre la tarjeta y la ficha: un producto con varios sabores
 * donde solo el más barato tiene oferta. La tarjeta dice «Desde $X» y la ficha
 * abre con ese mismo sabor y precio (antes abría con el primero, a precio normal),
 * y la tarjeta no tacha un precio anterior que es de un solo sabor.
 */
const run = uniq();
let tenant: Awaited<ReturnType<typeof createTenant>>;
const origin = () => `http://${tenant.handle}.localhost:3000`;

test.beforeAll(async () => {
  const ownerId = await createAuthUser(`precio-${run}@example.test`);
  tenant = await createTenant(`pc${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Vela aromática",
        options: [{ name: "Aroma", values: ["Lavanda", "Vainilla", "Cedro"] }],
        variants: [
          { options: { Aroma: "Lavanda" }, price: 139900, sku: `PC-LAV-${run}` },
          // El sabor barato es el único con oferta y queda al final del orden alfabético:
          // la ficha lo abría en último lugar (con el primero, «Cedro», a precio normal).
          {
            options: { Aroma: "Vainilla" },
            price: 125900,
            compare_at_price: 139900,
            sku: `PC-VAI-${run}`,
          },
          { options: { Aroma: "Cedro" }, price: 139900, sku: `PC-CED-${run}` },
        ],
      })}) as r`;
    for (const sku of ["LAV", "VAI", "CED"]) {
      const [v] = await sql<{ id: string }[]>`
        select id from public.product_variants where sku = ${`PC-${sku}-${run}`.toUpperCase()}`;
      await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 5, 'Inicial')`;
    }
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
  });
});

test("la ficha abre con el precio que anunció la tarjeta, y la tarjeta no tacha de más", async ({
  page,
}) => {
  await page.goto(`${origin()}/productos`);
  const card = page.locator(".sf-card, li").filter({ hasText: "Vela aromática" }).first();
  await expect(card).toContainText("Desde");
  await expect(card).toContainText("$1,259.00");
  // El precio anterior es de un solo sabor: la tarjeta no lo tacha.
  await expect(card.locator("s")).toHaveCount(0);

  await page.getByRole("link", { name: "Vela aromática" }).first().click();
  // Abre con «Vainilla», el sabor más barato, y no con «Cedro» (el primero).
  await expect(page.getByRole("radio", { name: "Vainilla" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Cedro" })).not.toBeChecked();
  const price = page.locator("p.tabular-nums").filter({ hasText: "$1,259.00" });
  await expect(price).toBeVisible();

  // Cambiar de sabor cambia el precio con honestidad.
  await page.getByText("Lavanda", { exact: true }).click();
  await expect(page.locator("p.tabular-nums").filter({ hasText: "$1,399.00" })).toBeVisible();
});
