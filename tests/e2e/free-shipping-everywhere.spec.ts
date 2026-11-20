import { expect, test } from "@playwright/test";

import { admin, createAuthUser, createTenant, uniq } from "./support";

/**
 * Envío gratis siempre (regla «gratis desde» con mínimo $0 y zona de todo el
 * país): la tienda dice «Envío gratis a todo México» en la franja de confianza,
 * la ficha y el carrito; nunca «desde $0.00» ni «te faltan».
 */
const run = uniq();
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId: string;
const origin = () => `http://${tenant.handle}.localhost:3000`;

async function asOwner<T>(work: (sql: typeof admin) => Promise<T>): Promise<T> {
  return (await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    return work(sql as unknown as typeof admin);
  })) as T;
}

test.beforeAll(async () => {
  ownerId = await createAuthUser(`gratis-${run}@example.test`);
  tenant = await createTenant(`eg${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now(), country = 'MX' where id = ${tenant.storeId}`;
  await asOwner(async (sql) => {
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Taza de barro",
        variants: [{ price: 25000, sku: `GRATIS-${run}`, weight_g: 400 }],
      })}) as r`;
    const [v] = await sql<{ id: string }[]>`
      select id from public.product_variants where sku = ${`GRATIS-${run}`.toUpperCase()}`;
    await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 20, 'Inicial')`;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
    // Todo México (sin estados): la regla llega a todo el país.
    const [z] = await sql<{ id: string }[]>`
      select public.shipping_upsert_zone(${tenant.storeId}, ${sql.json({ name: "Todo México", countries: ["MX"] })}) as id`;
    await sql`select public.shipping_upsert_rate(${tenant.storeId}, ${sql.json({
      zone_id: z!.id,
      name: "Envío gratis",
      type: "free_over",
      price: 0,
      free_over_subtotal: 0,
      est_days_min: 1,
      est_days_max: 2,
    })})`;
  });
});

test("sin mínimo: «Envío gratis a todo México» en la ficha y el carrito, nunca «$0.00»", async ({
  page,
}) => {
  await page.goto(`${origin()}/productos/taza-de-barro`);
  const facts = page.locator(".sf-pdp-facts");
  await expect(facts).toContainText("Envío gratis a todo México.");
  await expect(facts).not.toContainText("$0.00");

  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado al carrito." })).toBeVisible();
  await page.goto(`${origin()}/carrito`);
  await expect(page.getByText("Tu pedido tiene envío gratis a todo México.")).toBeVisible();
  await expect(page.getByText(/Te faltan/)).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("desde $0.00");
});
