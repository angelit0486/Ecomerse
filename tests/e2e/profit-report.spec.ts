import { createHash, randomBytes } from "node:crypto";

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
 * Reporte de rentabilidad (interruptor profit_report): apagado no aparece; la
 * dueña lo enciende en Ajustes → Funciones; la utilidad sale de un pedido real
 * (checkout de la tienda) con el costo del momento de la venta.
 */
const run = uniq();
const ownerEmail = `utilidad-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId: string;
let variantId: string;

async function asOwner<T>(work: (sql: typeof admin) => Promise<T>): Promise<T> {
  return (await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    return work(sql as unknown as typeof admin);
  })) as T;
}

test.beforeAll(async () => {
  ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`ut${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now(), tax_rate_bps = 0
               where id = ${tenant.storeId}`;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${tenant.storeId}, 'Taza de barro', 'taza', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature)
    values (${tenant.storeId}, ${p!.id}, ${`UT-${run}`}, 10000, '') returning id`;
  variantId = v!.id;
  await admin`insert into public.variant_costs (store_id, variant_id, cost)
              values (${tenant.storeId}, ${variantId}, 4000)`;
  await admin`select app.apply_inventory_movement(${tenant.storeId}, l.id, 'initial', 5, 0)
                from public.inventory_levels l where l.variant_id = ${variantId}`;
  const [acct] = await admin<{ id: string }[]>`
    insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
    values (${tenant.storeId}, 'manual', 'active', 'Transferencia', '{"instructions":"CLABE 0123456789"}')
    returning id`;
  const rateId = await asOwner(async (sql) => {
    const [z] = await sql<{ id: string }[]>`
      select public.shipping_upsert_zone(${tenant.storeId}, ${sql.json({ name: "México", countries: ["MX"] })}) as id`;
    const [r] = await sql<{ id: string }[]>`
      select public.shipping_upsert_rate(${tenant.storeId}, ${sql.json({
        zone_id: z!.id,
        name: "Estándar",
        type: "flat",
        price: 9900,
      })}) as id`;
    return r!.id;
  });
  const cart = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${tenant.storeId}, ${cart}, ${variantId}, 2)`;
  const [o] = await admin<{ r: { order_id: string; payment: { id: string } } }[]>`
    select storefront.place_order(${tenant.storeId}, ${cart}, ${admin.json({
      email: `cliente-${run}@example.test`,
      customer_name: "Ana Ruiz",
      phone: "222 123 4567",
      shipping_address: {
        recipient_name: "Ana Ruiz",
        line1: "Av. Juárez 10",
        line2: "Centro",
        city: "Puebla",
        region: "Puebla",
        postal_code: "72000",
        country: "MX",
      },
      shipping_rate_id: rateId,
      payment_account_id: acct!.id,
    })}, ${20000 + 9900}, ${`idem-${randomBytes(12).toString("hex")}`},
       ${createHash("sha256").update(randomBytes(32)).digest()}) as r`;
  await admin`select app.confirm_order_payment(${o!.r.payment.id}, 'system', 'manual')`;
  // El costo sube después de vender: el reporte conserva el del momento de la venta.
  await admin`update public.variant_costs set cost = 9000 where variant_id = ${variantId}`;
});

test("rentabilidad: apagada no aparece; utilidad con el costo del día de la venta", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  const base = `/admin/${tenant.handle}`;
  await page.goto(base);
  await expect(page.getByRole("link", { name: "Rentabilidad", exact: true })).toHaveCount(0);
  expect((await page.goto(`${base}/rentabilidad`))?.status()).toBe(404);

  await page.goto(`${base}/ajustes/funciones`);
  await page
    .getByRole("form", { name: "Rentabilidad" })
    .getByRole("button", { name: "Encender rentabilidad" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Rentabilidad: encendida." }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Rentabilidad", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Rentabilidad", level: 1 })).toBeVisible();
  // 2 tazas a $100 = $200 de venta (el envío de $99 no cuenta); costo 2 × $40.
  const card = (label: string) =>
    page.locator("dl").first().locator("div").filter({ hasText: label }).locator("dd");
  await expect(card("Utilidad")).toHaveText("$120.00");
  await expect(card("Margen")).toHaveText("60.0 %");
  await expect(card("Venta de productos")).toHaveText("$200.00");
  await expect(card("Costo de lo vendido")).toHaveText("$80.00");
  const row = page.getByRole("row").filter({ hasText: "Taza de barro" });
  await expect(row).toContainText("$120.00");
  await expect(row).toContainText("60.0 %");
  await expect(
    page.getByText("Todavía no se descuentan las comisiones de tu medio de pago"),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Otro periodo sigue mostrando el pedido de hoy.
  await page.getByRole("link", { name: "7 días" }).click();
  await expect(card("Utilidad")).toHaveText("$120.00");
});
