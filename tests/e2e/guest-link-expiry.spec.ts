import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  MAIL,
  runJobs,
  uniq,
} from "./support";

/**
 * ADR-062 A: el enlace del pedido de invitado vale 180 días desde la última
 * actividad. Vencido, la página ofrece «Mandarme un enlace nuevo»: llega al
 * correo del pedido, el anterior deja de servir y un token cualquiera sigue
 * dando el mismo 404.
 */
const run = uniq();
const buyer = `cliente-enlace-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId: string;
let orderId: string;
let token: string;
const origin = () => `http://${tenant.handle}.localhost:3000`;

async function asOwner<T>(work: (sql: typeof admin) => Promise<T>): Promise<T> {
  return (await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    return work(sql as unknown as typeof admin);
  })) as T;
}

/** Texto del último correo a `buyer` con ese asunto (Mailpit), tras correr la cola. */
async function lastMail(subject: RegExp): Promise<string> {
  let text = "";
  await expect
    .poll(
      async () => {
        await runJobs();
        const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${buyer}`)}`);
        const { messages } = (await res.json()) as { messages: { ID: string; Subject: string }[] };
        const hit = messages.find((m) => subject.test(m.Subject));
        if (!hit) return false;
        const message = await fetch(`${MAIL}/api/v1/message/${hit.ID}`);
        text = ((await message.json()) as { Text: string }).Text;
        return true;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return text;
}

test.beforeAll(async () => {
  ownerId = await createAuthUser(`enlace-${run}@example.test`);
  tenant = await createTenant(`ge${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now(), tax_rate_bps = 0
               where id = ${tenant.storeId}`;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${tenant.storeId}, 'Taza de barro', 'taza', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature)
    values (${tenant.storeId}, ${p!.id}, ${`GL-${run}`}, 10000, '') returning id`;
  await admin`select app.apply_inventory_movement(${tenant.storeId}, l.id, 'initial', 5, 0)
                from public.inventory_levels l where l.variant_id = ${v!.id}`;
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
  token = randomBytes(32).toString("base64url");
  const cart = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${tenant.storeId}, ${cart}, ${v!.id}, 1)`;
  const [o] = await admin<{ r: { order_id: string; payment: { id: string } } }[]>`
    select storefront.place_order(${tenant.storeId}, ${cart}, ${admin.json({
      email: buyer,
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
    })}, ${10000 + 9900}, ${`idem-${randomBytes(12).toString("hex")}`},
       ${createHash("sha256").update(token).digest()}) as r`;
  orderId = o!.r.order_id;
  await admin`select app.confirm_order_payment(${o!.r.payment.id}, 'system', 'manual')`;
});

test("enlace vencido: pedir uno nuevo por correo, el anterior deja de servir", async ({ page }) => {
  const oldLink = `${origin()}/pedido/${orderId}?t=${token}`;
  // Vigente: se ve el pedido.
  await page.goto(oldLink);
  await expect(page.getByText(/Pedido #\d+/).first()).toBeVisible();

  // 181 días sin actividad: vencido. No se muestra nada del pedido.
  await admin.begin(async (sql) => {
    await sql`set local session_replication_role = replica`;
    await sql`update public.orders set created_at = now() - interval '200 days',
                                       updated_at = now() - interval '181 days' where id = ${orderId}`;
  });
  await page.goto(oldLink);
  await expect(page.getByRole("heading", { name: "Este enlace venció" })).toBeVisible();
  await expect(page.getByText("Taza de barro")).toHaveCount(0);
  await expect(page.getByText(buyer)).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("button", { name: "Mandarme un enlace nuevo" }).click();
  await expect(page.getByRole("status")).toContainText("Te enviamos un enlace nuevo");

  // Llega al correo del pedido, con un enlace distinto que sí abre el pedido.
  const text = await lastMail(/Tu enlace para ver el pedido/);
  const link = /\/pedido\/[0-9a-f-]{36}\?t=[A-Za-z0-9_-]{43}/.exec(text)?.[0];
  expect(link).toBeTruthy();
  expect(link).not.toContain(token);
  await page.goto(`${origin()}${link}`);
  await expect(page.getByText(/Pedido #\d+/).first()).toBeVisible();
  await expect(page.getByText("Taza de barro").first()).toBeVisible();

  // El anterior ya no sirve; pedir otro en la misma hora no manda otro correo.
  await page.goto(oldLink);
  await expect(page.getByRole("heading", { name: "Este enlace ya no funciona" })).toBeVisible();
  await page.getByRole("button", { name: "Mandarme un enlace nuevo" }).click();
  await expect(page.getByRole("status")).toContainText("en la última hora");

  // Un token cualquiera: el mismo 404 de siempre.
  const other = await page.goto(
    `${origin()}/pedido/${orderId}?t=${randomBytes(32).toString("base64url")}`,
  );
  expect(other?.status()).toBe(404);
});
