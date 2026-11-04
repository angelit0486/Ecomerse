import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import { admin, createAuthUser, createTenant, loginNewStaff, uniq } from "./support";

/**
 * Mantenimiento sin cron (docs/plan/PRIMER-PEDIDO.md, riesgo 2): un pedido sin
 * pagar cuya reserva venció se cancela y libera el stock con la actividad de la
 * tienda (aquí, la dueña abriendo «Pendientes de pago»), aunque Vercel Cron no
 * llame al runner. Nunca se llama a /api/jobs/run en esta prueba.
 */
const run = uniq();
const ownerEmail = `mant-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId: string;
let orderId: string;

test.beforeAll(async () => {
  ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`mt${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  const variantId = await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Vela",
        variants: [{ price: 10000, sku: `VELA-${run}`, requires_shipping: false }],
      })}) as r`;
    const [v] = await sql<{ id: string }[]>`
      select id from public.product_variants where sku = ${`VELA-${run}`.toUpperCase()}`;
    await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 5, 'Inicial')`;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
    return v!.id;
  });
  const [account] = await admin<{ id: string }[]>`
    insert into public.payment_accounts (store_id, provider, status, display_name)
    values (${tenant.storeId}, 'manual', 'active', 'Transferencia') returning id`;
  const token = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${tenant.storeId}, ${token}, ${variantId}, 2)`;
  const idem = `idem-${randomBytes(12).toString("hex")}`;
  const [o] = await admin<{ r: { order_id: string } }[]>`
    select storefront.place_order(${tenant.storeId}, ${token},
      ${admin.json({ email: `c-${run}@example.test`, customer_name: "C", payment_account_id: account!.id })},
      20000, ${idem}, ${createHash("sha256").update(idem).digest()}) as r`;
  orderId = o!.r.order_id;
  // El comprador cerró la ventana y la reserva ya venció.
  await admin`update public.inventory_reservations set expires_at = now() - interval '1 minute'
               where store_id = ${tenant.storeId} and order_id = ${orderId}`;
});

test("un pendiente vencido se cancela y libera el stock sin el cron", async ({ page }) => {
  test.setTimeout(150_000);
  await loginNewStaff(page, ownerEmail);
  const state = async () =>
    (await admin<{ status: string }[]>`select status from public.orders where id = ${orderId}`)[0]!
      .status;
  expect(await state()).toBe("pending_payment");
  // La dueña revisa sus pendientes cada pocos segundos (como mucho un minuto).
  await expect
    .poll(
      async () => {
        await page.goto(`/admin/${tenant.handle}/pedidos?estado=pendientes`);
        return state();
      },
      { timeout: 120_000, intervals: [5_000] },
    )
    .toBe("cancelled");
  const [r] = await admin<{ status: string }[]>`
    select status from public.inventory_reservations where order_id = ${orderId}`;
  expect(r!.status).not.toBe("active");
  await page.goto(`/admin/${tenant.handle}/pedidos?estado=cancelados`);
  await expect(page.getByText("Cancelado").first()).toBeVisible();
});
