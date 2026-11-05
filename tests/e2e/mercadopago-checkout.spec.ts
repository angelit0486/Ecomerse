import { expect, test, type Page } from "@playwright/test";

import { FakeMercadoPago } from "./fake-mercadopago";
import { admin, createAuthUser, createTenant, MAIL, runJobs, uniq } from "./support";

/**
 * Cobro con Mercado Pago de punta a punta contra el Mercado Pago simulado
 * (fake-mercadopago.ts; la app arranca con MERCADOPAGO_API_BASE apuntando a él).
 * El pedido nace «pendiente de pago»; solo el webhook firmado, con monto y
 * moneda iguales, lo deja pagado. El regreso del comprador nunca confirma nada.
 */
test.describe.configure({ mode: "serial" });

const run = uniq();
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId: string;
let variantId: string;
const fake = new FakeMercadoPago();
const origin = () => `http://${tenant.handle}.localhost:3000`;

async function mails(to: string, subject: RegExp) {
  const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  const { messages } = (await res.json()) as { messages: { Subject: string }[] };
  return messages.filter((m) => subject.test(m.Subject)).length;
}

async function waitMails(to: string, subject: RegExp, n: number) {
  await expect
    .poll(
      async () => {
        await runJobs();
        return mails(to, subject);
      },
      { timeout: 20_000 },
    )
    .toBe(n);
}

async function order(email: string) {
  return (
    await admin<
      {
        id: string;
        status: string;
        payment_status: string;
        total: string;
        needs_attention: boolean;
      }[]
    >`select id, status, payment_status, total, needs_attention from public.orders
       where store_id = ${tenant.storeId} and email = ${email} order by created_at desc limit 1`
  )[0]!;
}

/** Compra hasta la pantalla de Mercado Pago; devuelve la preferencia creada. */
async function toMercadoPago(page: Page, email: string): Promise<string> {
  await page.goto(`${origin()}/productos/taza-de-barro`);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado al carrito." })).toBeVisible();
  await page.goto(`${origin()}/checkout`);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Nombre completo").fill("Ana Ruiz");
  await page.getByLabel(/^Teléfono/).fill("222 123 4567");
  await page.getByLabel("Calle, número e interior").fill("Av. Juárez 10");
  await page.getByLabel("Colonia").fill("Centro");
  await page.getByLabel("Ciudad o municipio").fill("Puebla");
  await page.getByLabel("Código postal").fill("72000");
  await expect(page.getByLabel("Estado", { exact: true })).toHaveValue("Puebla");
  await page.getByRole("radio", { name: /Mercado Pago/ }).check();
  const confirm = page.getByRole("button", { name: /Confirmar pedido/ });
  await confirm.click();
  const atMp = page.waitForURL(/mercadopago\.com\.mx/, { timeout: 15_000 }).then(() => true);
  const chose = page
    .getByText(/Elegimos «/)
    .waitFor({ timeout: 15_000 })
    .then(() => false);
  if (!(await Promise.race([atMp, chose]))) await confirm.click();
  await page.waitForURL(/mercadopago\.com\.mx/);
  await expect(page.getByRole("heading", { name: "Mercado Pago (simulado)" })).toBeVisible();
  const prefId = new URL(page.url()).searchParams.get("pref_id")!;
  expect(fake.preferences.has(prefId)).toBe(true);
  return prefId;
}

test.beforeAll(async () => {
  await fake.start();
  ownerId = await createAuthUser(`mp-${run}@example.test`);
  tenant = await createTenant(`mp${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  variantId = await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Taza de barro",
        variants: [{ price: 25000, sku: `MP-${run}`, weight_g: 400 }],
      })}) as r`;
    const [v] = await sql<{ id: string }[]>`
      select id from public.product_variants where sku = ${`MP-${run}`.toUpperCase()}`;
    await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 10, 'Inicial')`;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
    const [z] = await sql<{ id: string }[]>`
      select public.shipping_upsert_zone(${tenant.storeId}, ${sql.json({ name: "México", countries: ["MX"] })}) as id`;
    await sql`select public.shipping_upsert_rate(${tenant.storeId}, ${sql.json({
      zone_id: z!.id,
      name: "Estándar",
      type: "flat",
      price: 9900,
    })})`;
    return v!.id;
  });
  await admin`select system.mercadopago_attach_account(${tenant.storeId}, ${fake.collector}, 'test')`;
  await admin`insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
              values ('payment_pending_email', 'store', ${tenant.storeId}, true, 'E2E Mercado Pago')
              on conflict (flag_key, scope, scope_id) do update set enabled = true`;
});

test.afterAll(async () => {
  await fake.stop();
});

test.beforeEach(async ({ page }) => {
  // La pantalla de pago de Mercado Pago (la app solo redirige a mercadopago.com).
  await page.route("https://www.mercadopago.com.mx/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Mercado Pago</title><h1>Mercado Pago (simulado)</h1>",
    }),
  );
});

test("tarjeta aprobada: pagado solo por el webhook firmado; repetido no duplica nada", async ({
  page,
}) => {
  const email = `aprobado-${run}@example.test`;
  const prefId = await toMercadoPago(page, email);
  // ADR-059 A: la preferencia no ofrece pagos diferidos (OXXO, transferencia, cajero),
  // que caducarían junto con la reserva del inventario.
  expect(fake.preferences.get(prefId)!.payment_methods).toEqual({
    excluded_payment_types: [{ id: "ticket" }, { id: "bank_transfer" }, { id: "atm" }],
  });
  const before = await order(email);
  expect(before).toMatchObject({ status: "pending_payment" });
  const [stock] = await admin<{ on_hand: number; reserved: number }[]>`
    select on_hand, reserved from public.inventory_levels where variant_id = ${variantId}`;

  const paid = await fake.pay(prefId, "approved");
  expect(paid.webhook).toBe(200);
  // El webhook llegó antes que el comprador; al volver, la tienda ya lo muestra pagado.
  await page.goto(paid.back);
  await expect(page.getByRole("heading", { name: "Gracias por tu compra" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Pagado");
  expect(await order(email)).toMatchObject({ status: "open", payment_status: "paid" });

  // Mercado Pago repite el aviso: sin efectos nuevos.
  expect(await fake.webhook(paid.paymentId)).toBe(200);
  await waitMails(email, /Confirmamos tu pedido/, 1);
  const [after] = await admin<{ on_hand: number; reserved: number }[]>`
    select on_hand, reserved from public.inventory_levels where variant_id = ${variantId}`;
  // El stock se apartó una sola vez al crear el pedido; pagar (dos avisos) solo
  // confirma esa reserva, no vuelve a descontar.
  expect(after).toEqual(stock);
  const reservations = await admin<{ status: string }[]>`
    select status from public.inventory_reservations where order_id = ${before.id}`;
  expect(reservations.map((r) => r.status)).toEqual(["committed"]);
});

test("rechazado: el pedido sigue pendiente y se puede reintentar", async ({ page }) => {
  const email = `rechazo-${run}@example.test`;
  const prefId = await toMercadoPago(page, email);
  const rejected = await fake.pay(prefId, "rejected");
  await page.goto(rejected.back);
  await expect(page.getByRole("heading", { name: "Recibimos tu pedido" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar el pago" })).toBeVisible();
  expect(await order(email)).toMatchObject({ status: "pending_payment", payment_status: "failed" });
});

// Las preferencias nuevas ya no ofrecen OXXO (ADR-059 A); esta prueba cubre un cobro
// diferido que Mercado Pago avise de todos modos (p. ej., una ficha emitida antes del
// cambio): queda pendiente y solo se paga cuando se acredita.
test("OXXO: pendiente con su correo, y pagado cuando se acredita", async ({ page }) => {
  const email = `oxxo-${run}@example.test`;
  const prefId = await toMercadoPago(page, email);
  const oxxo = await fake.pay(prefId, "pending", "ticket");
  await page.goto(oxxo.back);
  await expect(page.getByRole("heading", { name: "Recibimos tu pedido" })).toBeVisible();
  expect(await order(email)).toMatchObject({
    status: "pending_payment",
    payment_status: "pending",
  });
  await waitMails(email, /está pendiente de pago/, 1);
  expect(await mails(email, /Confirmamos tu pedido/)).toBe(0);

  expect(await fake.update(oxxo.paymentId, "approved")).toBe(200);
  expect(await order(email)).toMatchObject({ status: "open", payment_status: "paid" });
  await waitMails(email, /Confirmamos tu pedido/, 1);
  expect(await mails(email, /está pendiente de pago/)).toBe(1);
});

test("monto distinto al del pedido: no se marca pagado y queda en atención", async ({ page }) => {
  const email = `monto-${run}@example.test`;
  const prefId = await toMercadoPago(page, email);
  const total = fake.preferences.get(prefId)!.total;
  const wrong = await fake.pay(prefId, "approved", "credit_card", total - 1);
  expect(wrong.webhook).toBe(200);
  expect(await order(email)).toMatchObject({
    status: "pending_payment",
    needs_attention: true,
  });
});

test("webhook con firma inválida: se rechaza y no cambia nada", async ({ page }) => {
  const email = `firma-${run}@example.test`;
  const prefId = await toMercadoPago(page, email);
  const forged = await fake.pay(
    prefId,
    "approved",
    "credit_card",
    undefined,
    "otraclavequenoesla00000",
  );
  expect(forged.webhook).toBe(401);
  expect(await order(email)).toMatchObject({ status: "pending_payment" });
  // El mismo cobro, avisado con la firma correcta, sí paga el pedido.
  expect(await fake.webhook(forged.paymentId)).toBe(200);
  expect(await order(email)).toMatchObject({ status: "open", payment_status: "paid" });
});
