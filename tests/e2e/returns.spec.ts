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
 * Devoluciones (ADR-061; interruptor `returns`): apagado no aparece; la dueña lo
 * enciende en Ajustes → Funciones; el cliente la pide desde la página de su
 * pedido; la dueña la aprueba con instrucciones, la recibe y reembolsa con
 * reposición; el cliente recibe sus correos y el inventario vuelve.
 */
test.describe.configure({ mode: "serial" });

const run = uniq();
const ownerEmail = `devol-${run}@example.test`;
const buyer = `cliente-devol-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId: string;
let variantId: string;
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

async function mails(subject: RegExp) {
  const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${buyer}`)}`);
  const { messages } = (await res.json()) as { messages: { Subject: string }[] };
  return messages.filter((m) => subject.test(m.Subject)).length;
}

async function waitMail(subject: RegExp) {
  await expect
    .poll(
      async () => {
        await runJobs();
        return mails(subject);
      },
      { timeout: 20_000 },
    )
    .toBe(1);
}

async function onHand() {
  const [l] = await admin<{ on_hand: number }[]>`
    select on_hand from public.inventory_levels where variant_id = ${variantId}`;
  return l!.on_hand;
}

test.beforeAll(async () => {
  ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`dv${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now(), tax_rate_bps = 0
               where id = ${tenant.storeId}`;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${tenant.storeId}, 'Taza de barro', 'taza', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature)
    values (${tenant.storeId}, ${p!.id}, ${`DEV-${run}`}, 10000, '') returning id`;
  variantId = v!.id;
  await admin`select app.apply_inventory_movement(${tenant.storeId}, l.id, 'initial', 20, 0)
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
  // Pedido pagado de 2 tazas, con el enlace del cliente (token propio de la prueba).
  token = randomBytes(32).toString("base64url");
  const cart = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${tenant.storeId}, ${cart}, ${variantId}, 2)`;
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
    })}, ${2 * 10000 + 9900}, ${`idem-${randomBytes(12).toString("hex")}`},
       ${createHash("sha256").update(token).digest()}) as r`;
  orderId = o!.r.order_id;
  await admin`select app.confirm_order_payment(${o!.r.payment.id}, 'system', 'manual')`;
  // La tienda envía las 2 tazas.
  await asOwner(
    (sql) => sql`select public.orders_fulfill(${tenant.storeId}, ${orderId},
      (select jsonb_agg(jsonb_build_object('order_item_id', i.id, 'quantity', i.quantity))
         from public.order_items i where i.order_id = ${orderId}),
      'Estafeta', 'GUIA123', null, ${`envio-${run}-0000000000`})`,
  );
});

test("devolución: el cliente la pide, la dueña la aprueba, la recibe y reembolsa con reposición", async ({
  page,
  browser,
}) => {
  const orderPage = `${origin()}/pedido/${orderId}?t=${token}`;
  const shopper = await (await browser.newContext()).newPage();

  // Apagado: ni el cliente ni el panel la ven.
  await shopper.goto(orderPage);
  await expect(shopper.getByRole("heading", { name: "Devoluciones" })).toHaveCount(0);
  await loginNewStaff(page, ownerEmail);
  const base = `/admin/${tenant.handle}/pedidos`;
  expect((await page.goto(`${base}/devoluciones`))?.status()).toBe(404);

  // La dueña la enciende en Ajustes → Funciones.
  await page.goto(`/admin/${tenant.handle}/ajustes/funciones`);
  await page
    .getByRole("form", { name: "Devoluciones" })
    .getByRole("button", { name: "Encender devoluciones" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Devoluciones: encendida." }),
  ).toBeVisible();

  // El cliente pide devolver 1 taza.
  await shopper.reload();
  const form = shopper.getByRole("form", { name: "Pedir una devolución" });
  await expect(form).toBeVisible();
  await form.getByLabel("Unidades de Taza de barro a devolver").fill("1");
  await form.getByLabel("Motivo").selectOption({ label: "Llegó dañado" });
  await form.getByLabel(/Cuéntanos qué pasó/).fill("El asa venía rota.");
  await expectNoSeriousA11yViolations(shopper);
  await form.getByRole("button", { name: "Pedir devolución" }).click();
  await expect(
    shopper.getByRole("status").filter({ hasText: "Recibimos tu solicitud" }),
  ).toBeVisible();
  await waitMail(/Recibimos tu solicitud de devolución/);

  // La dueña la ve por revisar y la aprueba con instrucciones.
  await page.goto(`${base}/devoluciones`);
  await expect(page.getByRole("link", { name: "Por revisar (1)" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("link", { name: /^Pedido / }).click();
  await expect(page.getByText("El asa venía rota.")).toBeVisible();
  await page
    .getByRole("form", { name: "Aprobar la devolución" })
    .getByLabel(/Instrucciones para el cliente/)
    .fill("Envíala a Av. Reforma 22, Puebla, con tu número de pedido.");
  await page.getByRole("button", { name: "Aprobar devolución" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Devolución aprobada" })).toBeVisible();
  await waitMail(/devolución del pedido .* fue aprobada/);

  // El cliente ve las instrucciones en su pedido.
  await shopper.reload();
  await expect(shopper.getByText("Tu devolución fue aprobada.")).toBeVisible();
  await expect(shopper.getByText(/Mensaje de la tienda: Envíala a Av\. Reforma 22/)).toBeVisible();

  // Llega el paquete y se reembolsa con reposición.
  await page.getByRole("button", { name: "Registrar que llegó" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Devolución recibida." })).toBeVisible();
  const before = await onHand();
  const refund = page.getByRole("form", { name: "Reembolsar la devolución" });
  await expect(refund.getByLabel(/Monto a reembolsar/)).toHaveValue("100.00");
  await expectNoSeriousA11yViolations(page);
  await refund.getByRole("button", { name: "Reembolsar" }).click();
  await page
    .getByRole("button", { name: /Sí|Confirmar/ })
    .last()
    .click();
  await expect(page.getByRole("status").filter({ hasText: "Reembolso solicitado" })).toBeVisible();

  // Pago manual: el reembolso se confirma en la base y la taza vuelve al inventario.
  await expect
    .poll(
      async () => {
        await runJobs();
        const [r] = await admin<{ status: string }[]>`
          select r.status from public.refunds r
            join public.return_requests q on q.refund_id = r.id where q.order_id = ${orderId}`;
        return r?.status;
      },
      { timeout: 20_000 },
    )
    .toBe("succeeded");
  expect(await onHand()).toBe(before + 1);
  await waitMail(/Reembolso de/);
});
