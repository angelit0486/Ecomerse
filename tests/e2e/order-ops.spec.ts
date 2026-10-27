import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  runJobs,
  uniq,
} from "./support";

/**
 * F7-T06: operación del pedido en el panel. Surtir parcial, entregar, reembolsar
 * (se aplica al confirmarse, vía job) y cancelar con reembolso total.
 */
let run: string;
let ownerEmail: string;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let variantId: string;

async function paidOrder(qty: number): Promise<string> {
  const [acct] = await admin<{ id: string }[]>`
    select id from public.payment_accounts where store_id = ${tenant.storeId} and provider = 'manual'`;
  const token = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${tenant.storeId}, ${token}, ${variantId}, ${qty})`;
  const idem = `idem-${randomBytes(12).toString("hex")}`;
  const [o] = await admin<{ r: { order_id: string; payment: { id: string } } }[]>`
    select storefront.place_order(${tenant.storeId}, ${token}, ${admin.json({
      email: `c-${run}@example.test`,
      customer_name: "Cliente",
      payment_account_id: acct!.id,
    })}, ${10000 * qty}, ${idem}, ${createHash("sha256").update(idem).digest()}) as r`;
  await admin`select app.confirm_order_payment(${o!.r.payment.id}, 'system', 'manual')`;
  return o!.r.order_id;
}

// Cada prueba con su tienda y su dueño (la 2FA se activa una sola vez por usuario).
test.beforeEach(async () => {
  run = uniq();
  ownerEmail = `ops-${run}@example.test`;
  tenant = await createTenant(`q${run}`, await createAuthUser(ownerEmail));
  await admin`update public.stores set status = 'active', launched_at = now(), tax_rate_bps = 0
               where id = ${tenant.storeId}`;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${tenant.storeId}, 'Vela', 'vela', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature, requires_shipping)
    values (${tenant.storeId}, ${p!.id}, ${`VELA-${run}`}, 10000, '', false) returning id`;
  variantId = v!.id;
  await admin`select app.apply_inventory_movement(${tenant.storeId}, l.id, 'initial', 20, 0)
                from public.inventory_levels l where l.variant_id = ${variantId}`;
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
              values (${tenant.storeId}, 'manual', 'active', 'Transferencia', '{"instructions":"CLABE 0123456789"}')`;
});

test("surtir parcial → entregar → reembolso parcial confirmado", async ({ page }) => {
  const orderId = await paidOrder(3);
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/pedidos/${orderId}`);

  await page.getByLabel("Unidades de Vela").fill("1");
  await page.getByLabel("Paquetería (opcional)").fill("Estafeta");
  await page.getByLabel("Enlace de rastreo (opcional)").fill("http://inseguro.test");
  await page.getByRole("button", { name: "Registrar envío" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "https://" })).toBeVisible();
  // Lo escrito se conserva tras el error.
  await expect(page.getByLabel("Unidades de Vela")).toHaveValue("1");
  await expect(page.getByLabel("Paquetería (opcional)")).toHaveValue("Estafeta");
  await page.getByLabel("Enlace de rastreo (opcional)").fill("https://rastreo.test/ABC");
  await page.getByRole("button", { name: "Registrar envío" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Envío registrado." })).toBeVisible();
  await expect(page.getByLabel("Unidades de Vela")).toHaveValue("2"); // quedan 2
  // Con unidades enviadas ya no se puede cancelar.
  await expect(page.getByRole("button", { name: "Cancelar pedido" })).toHaveCount(0);

  await page.getByRole("button", { name: "Marcar entregado" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Envío marcado como entregado." }),
  ).toBeVisible();
  await expect(page.getByText(/^Entregado · Estafeta/)).toBeVisible();

  await page.getByText("Reembolsar dinero").click();
  await page.getByLabel(/Monto a reembolsar/).fill("400");
  await page.getByRole("button", { name: "Solicitar reembolso" }).click();
  await page.getByRole("button", { name: "Sí, solicitar reembolso" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Revisa los datos" })).toBeVisible();
  await page.getByLabel(/Monto a reembolsar/).fill("100.50");
  // Tras el error la pregunta se cerró: se vuelve a preguntar, ya con el monto nuevo.
  await page.getByRole("button", { name: "Solicitar reembolso" }).click();
  await expect(page.getByRole("group", { name: /^¿Reembolsar 100\.50 \(máximo / })).toBeVisible();
  await page.getByRole("button", { name: "Sí, solicitar reembolso" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Reembolso solicitado." })).toBeVisible();
  await expect(page.getByText(/En proceso/)).toBeVisible();
  await runJobs();
  await page.reload();
  await expect(page.getByText(/· Reembolsado/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  const [o] = await admin<{ refunded_total: string; fulfillment_status: string }[]>`
    select refunded_total, fulfillment_status from public.orders where id = ${orderId}`;
  expect(o).toEqual({ refunded_total: "10050", fulfillment_status: "partially_fulfilled" });
});

test("cancelar un pedido pagado: confirma, libera existencias y reembolsa todo", async ({
  page,
}) => {
  const orderId = await paidOrder(2);
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/pedidos/${orderId}`);
  await page.getByText("Cancelar el pedido").click();
  await page.getByRole("button", { name: "Cancelar pedido" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Confirma" })).toBeVisible();
  await page.getByLabel(/Entiendo que se cancelará y se reembolsará/).check();
  await page.getByRole("button", { name: "Cancelar pedido" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Pedido cancelado." })).toBeVisible();
  await runJobs();
  const [o] = await admin<{ status: string; payment_status: string }[]>`
    select status, payment_status from public.orders where id = ${orderId}`;
  expect(o).toEqual({ status: "cancelled", payment_status: "refunded" });
});

test("surtir varios pedidos a la vez desde «Por surtir» (misión panel, F3)", async ({ page }) => {
  const first = await paidOrder(1);
  const second = await paidOrder(2);
  const untouched = await paidOrder(1);
  const [n1, n2] = await admin<{ display_number: string }[]>`
    select display_number from public.orders where id in (${first}, ${second}) order by placed_at`;
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/pedidos?estado=por-surtir`);
  await page.getByLabel(`Elegir el pedido ${n1!.display_number}`).check();
  await page.getByLabel(`Elegir el pedido ${n2!.display_number}`).check();
  await page.getByRole("button", { name: "Surtir los elegidos" }).click();
  // Confirmación explícita: avisa que no lleva guía y que el cliente recibe el aviso.
  await expect(page.getByText(/sin número de guía/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("button", { name: "Sí, surtir 2" }).click();
  await expect(page.getByRole("status").filter({ hasText: "2 pedidos surtidos" })).toBeVisible();

  const rows = await admin<{ id: string; fulfillment_status: string }[]>`
    select id, fulfillment_status from public.orders where id in (${first}, ${second}, ${untouched})`;
  const status = Object.fromEntries(rows.map((r) => [r.id, r.fulfillment_status]));
  expect(status[first]).toBe("fulfilled");
  expect(status[second]).toBe("fulfilled");
  expect(status[untouched]).toBe("unfulfilled");
  // El pendiente sigue en la lista; los surtidos ya no.
  await expect(page.getByLabel(`Elegir el pedido ${n1!.display_number}`)).toHaveCount(0);
});
