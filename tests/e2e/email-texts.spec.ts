import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  MAIL,
  runJobs,
  uniq,
} from "./support";

/**
 * Correos con el texto de la tienda (auditoría global, paso 20; interruptor
 * email_texts): apagado no aparece; la dueña cambia el asunto y agrega un
 * mensaje con variables y vista previa; el cliente lo recibe escapado y con los
 * datos del pedido intactos.
 */
const run = uniq();
const ownerEmail = `correos-${run}@example.test`;
const buyer = `cliente-correos-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId: string;
let orderId: string;

async function asOwner<T>(work: (sql: typeof admin) => Promise<T>): Promise<T> {
  return (await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    return work(sql as unknown as typeof admin);
  })) as T;
}

test.beforeAll(async () => {
  ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`ct${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now(), tax_rate_bps = 0
               where id = ${tenant.storeId}`;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${tenant.storeId}, 'Taza de barro', 'taza', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature)
    values (${tenant.storeId}, ${p!.id}, ${`CT-${run}`}, 10000, '') returning id`;
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
  const cart = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${tenant.storeId}, ${cart}, ${v!.id}, 1)`;
  const idem = `idem-${randomBytes(12).toString("hex")}`;
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
    })}, ${10000 + 9900}, ${idem}, ${createHash("sha256").update(idem).digest()}) as r`;
  orderId = o!.r.order_id;
  await admin`select app.confirm_order_payment(${o!.r.payment.id}, 'system', 'manual')`;
});

test("correos con el texto de la tienda: asunto y mensaje con variables, escapados", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  const base = `/admin/${tenant.handle}`;
  expect((await page.goto(`${base}/ajustes/correos`))?.status()).toBe(404);

  await page.goto(`${base}/ajustes/funciones`);
  await page
    .getByRole("form", { name: "Correos con tu texto" })
    .getByRole("button", { name: "Encender correos con tu texto" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Correos con tu texto: encendida." }),
  ).toBeVisible();

  await page.goto(`${base}/ajustes/correos`);
  const shipped = page.getByRole("form", { name: "Pedido enviado" });
  await shipped.getByLabel("Asunto (opcional)").fill("¡{nombre}, tu pedido {pedido} ya salió!");
  await shipped
    .getByLabel("Mensaje de la tienda (opcional)")
    .fill("Gracias por comprar en {tienda} <b>hecho a mano</b>.");
  const preview = shipped.getByRole("group", { name: "Vista previa: Pedido enviado" });
  await expect(preview).toContainText("Asunto: ¡Ana Ruiz, tu pedido #1001 ya salió!");
  await expect(preview).toContainText(`Gracias por comprar en ${tenant.name} <b>hecho a mano</b>.`);
  await expectNoSeriousA11yViolations(page);
  await shipped.getByRole("button", { name: "Guardar" }).click();
  await expect(shipped.getByText("Texto guardado.")).toBeVisible();

  // La tienda envía el pedido: el cliente recibe el asunto y el mensaje de la tienda.
  await asOwner(
    (sql) => sql`select public.orders_fulfill(${tenant.storeId}, ${orderId},
      (select jsonb_agg(jsonb_build_object('order_item_id', i.id, 'quantity', i.quantity))
         from public.order_items i where i.order_id = ${orderId}),
      'Estafeta', 'GUIA123', null, ${`envio-${run}-0000000000`})`,
  );
  let found: { ID: string; Subject: string } | undefined;
  await expect
    .poll(
      async () => {
        await runJobs();
        const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${buyer}`)}`);
        const { messages } = (await res.json()) as { messages: { ID: string; Subject: string }[] };
        found = messages.find((m) => /ya salió/.test(m.Subject));
        return found?.Subject;
      },
      { timeout: 20_000 },
    )
    .toMatch(/^¡Ana Ruiz, tu pedido #\d+ ya salió!$/);
  const full = (await (await fetch(`${MAIL}/api/v1/message/${found!.ID}`)).json()) as {
    HTML: string;
    Text: string;
  };
  expect(full.HTML).toContain(
    `Gracias por comprar en ${tenant.name} &lt;b&gt;hecho a mano&lt;/b&gt;.`,
  );
  expect(full.HTML).not.toContain("<b>hecho a mano</b>");
  expect(full.Text).toContain("Guía: Estafeta: GUIA123");
  expect(full.Text).toContain(`Gracias por comprar en ${tenant.name} <b>hecho a mano</b>.`);
});
