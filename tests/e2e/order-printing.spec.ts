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
 * Notas de empaque (auditoría global, paso 21; interruptor order_printing):
 * apagado no aparece; la dueña lo enciende en Ajustes → Funciones; imprime las
 * de «Por surtir» en lote o la de un pedido; al imprimir solo salen las notas;
 * cada línea muestra lo que falta por enviar.
 */
const run = uniq();
const ownerEmail = `notas-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId: string;
let variantId: string;
let rateId: string;
const orders: string[] = [];

async function asOwner<T>(work: (sql: typeof admin) => Promise<T>): Promise<T> {
  return (await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    return work(sql as unknown as typeof admin);
  })) as T;
}

async function paidOrder(qty: number, street: string): Promise<string> {
  const [acct] = await admin<{ id: string }[]>`
    select id from public.payment_accounts where store_id = ${tenant.storeId} and provider = 'manual'`;
  const token = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${tenant.storeId}, ${token}, ${variantId}, ${qty})`;
  const idem = `idem-${randomBytes(12).toString("hex")}`;
  const [o] = await admin<{ r: { order_id: string; payment: { id: string } } }[]>`
    select storefront.place_order(${tenant.storeId}, ${token}, ${admin.json({
      email: `c-${run}@example.test`,
      customer_name: "Ana Ruiz",
      phone: "222 123 4567",
      shipping_address: {
        recipient_name: "Ana Ruiz",
        line1: street,
        line2: "Centro",
        city: "Puebla",
        region: "Puebla",
        postal_code: "72000",
        country: "MX",
      },
      shipping_rate_id: rateId,
      payment_account_id: acct!.id,
    })}, ${10000 * qty + 9900}, ${idem}, ${createHash("sha256").update(idem).digest()}) as r`;
  await admin`select app.confirm_order_payment(${o!.r.payment.id}, 'system', 'manual')`;
  return o!.r.order_id;
}

test.beforeAll(async () => {
  ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`np${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now(), tax_rate_bps = 0
               where id = ${tenant.storeId}`;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${tenant.storeId}, 'Taza de barro', 'taza', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature)
    values (${tenant.storeId}, ${p!.id}, ${`TAZA-${run}`}, 10000, '') returning id`;
  variantId = v!.id;
  await admin`select app.apply_inventory_movement(${tenant.storeId}, l.id, 'initial', 20, 0)
                from public.inventory_levels l where l.variant_id = ${variantId}`;
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
              values (${tenant.storeId}, 'manual', 'active', 'Transferencia', '{"instructions":"CLABE 0123456789"}')`;
  rateId = await asOwner(async (sql) => {
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
  orders.push(await paidOrder(2, "Av. Juárez 10"));
  orders.push(await paidOrder(1, "Calle Reforma 22"));
});

test("notas de empaque: apagado no aparece; en lote y por pedido; solo las notas al imprimir", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  const base = `/admin/${tenant.handle}/pedidos`;
  await page.goto(`${base}?estado=por-surtir`);
  await expect(page.getByRole("link", { name: "Imprimir notas de empaque" })).toHaveCount(0);
  expect((await page.goto(`${base}/imprimir`))?.status()).toBe(404);

  // La dueña la enciende en Ajustes → Funciones.
  await page.goto(`/admin/${tenant.handle}/ajustes/funciones`);
  await page
    .getByRole("form", { name: "Notas de empaque" })
    .getByRole("button", { name: "Encender notas de empaque" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Notas de empaque: encendida." }),
  ).toBeVisible();

  // Envío parcial de la taza del primer pedido: su nota debe pedir solo la que falta.
  await page.goto(`${base}/${orders[0]}`);
  await page.getByLabel("Unidades de Taza de barro").fill("1");
  await page.getByRole("button", { name: "Registrar envío" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Envío registrado." })).toBeVisible();

  // Lote desde «Por surtir».
  await page.goto(`${base}?estado=por-surtir`);
  await page.getByRole("link", { name: "Imprimir notas de empaque" }).click();
  await expect(page.getByRole("heading", { name: "Notas de empaque (2)" })).toBeVisible();
  const slips = page.getByRole("article", { name: /Nota de empaque del pedido/ });
  await expect(slips).toHaveCount(2);
  const first = slips.first();
  await expect(first).toContainText("Av. Juárez 10, Centro");
  await expect(first).toContainText("Tel. 222 123 4567");
  await expect(first).toContainText(`TAZA-${run}`.toUpperCase());
  await expect(first.getByRole("cell", { name: "1", exact: true })).toBeVisible();
  await expect(slips.nth(1)).toContainText("Calle Reforma 22");
  await expect(page.getByRole("button", { name: "Imprimir 2 notas" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // Al imprimir: solo las notas, sin menú ni botones.
  await page.emulateMedia({ media: "print" });
  await expect(slips.first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Imprimir 2 notas" })).toBeHidden();
  await expect(page.getByRole("link", { name: "← Por surtir" })).toBeHidden();
  await expect(page.getByRole("navigation").first()).toBeHidden();
  await page.screenshot({ path: "test-results/notas-de-empaque-impresion.png", fullPage: true });
  await page.emulateMedia({ media: "screen" });

  // Nota de un pedido desde su detalle.
  await page.goto(`${base}/${orders[1]}`);
  await page.getByRole("link", { name: "Imprimir nota de empaque" }).click();
  await expect(page.getByRole("heading", { name: "Nota de empaque", level: 1 })).toBeVisible();
  await expect(page.getByRole("article", { name: /Nota de empaque del pedido/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Imprimir nota de empaque" })).toBeVisible();
});
