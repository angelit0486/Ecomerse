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
 * Inicio como centro de control (Orden 1): comparativo contra el periodo
 * anterior, antigüedad del pendiente más antiguo, carritos recuperables,
 * clientes nuevos vs. recurrentes, enlaces a listas filtradas y permisos.
 * Tienda propia (nunca una demo); los datos los siembra `admin`.
 */
const run = uniq();
const ownerEmail = `centro-${run}@example.test`;
const catalogEmail = `centro-cat-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const numbers: Record<string, string> = {};

/**
 * Pedido con fecha de colocación (y de pago, si `paid`) de hace `hoursAgo`
 * horas. `fulfilled` = ya surtido (no cuenta como «por surtir»).
 */
async function order(
  key: string,
  opts: {
    total: number;
    hoursAgo: number;
    customerId: string;
    paid: boolean;
    fulfilled?: boolean;
  },
) {
  const [o] = await admin<{ id: string; display_number: string }[]>`
    insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                               requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                               subtotal, total)
    select ${tenant.storeId}, n, '#' || n, ${`centro-${run}-${key}`}, 'c@example.test', 'C', false, 'MXN',
           true, 0, false, 0, 0
      from (select coalesce(max(number), 1000) + 1 as n from public.orders where store_id = ${tenant.storeId}) x
    returning id, display_number`;
  numbers[key] = o!.display_number;
  await admin.begin(async (sql) => {
    await sql`set local session_replication_role = replica`;
    await sql`update public.orders
                 set customer_id = ${opts.customerId}, subtotal = ${opts.total}, total = ${opts.total},
                     placed_at = now() - make_interval(hours => ${opts.hoursAgo}),
                     paid_total = ${opts.paid ? opts.total : 0},
                     paid_at = case when ${opts.paid} then now() - make_interval(hours => ${opts.hoursAgo}) end,
                     status = case when ${opts.paid} then 'open' else 'pending_payment' end,
                     payment_status = case when ${opts.paid} then 'paid' else 'pending' end,
                     fulfillment_status = ${opts.fulfilled ? "fulfilled" : "unfulfilled"}
               where id = ${o!.id}`;
  });
}

async function customer(email: string): Promise<string> {
  const [c] = await admin<{ id: string }[]>`
    insert into public.customers (store_id, email) values (${tenant.storeId}, ${email}) returning id`;
  return c!.id;
}

test.beforeAll(async () => {
  tenant = await createTenant(`cc${run}`, await createAuthUser(ownerEmail));
  const returning = await customer(`recurrente-${run}@compra.test`);
  const fresh = await customer(`nueva-${run}@compra.test`);
  const unpaid = await customer(`impaga-${run}@compra.test`);
  // Periodo anterior (días 30 a 59): $150.00 de la clienta que vuelve.
  await order("previo", {
    total: 15000,
    hoursAgo: 24 * 35,
    customerId: returning,
    paid: true,
    fulfilled: true,
  });
  // Periodo actual: $200.00 (ya surtido) + $100.00 por surtir desde hace 50 h.
  await order("reciente", {
    total: 20000,
    hoursAgo: 5,
    customerId: returning,
    paid: true,
    fulfilled: true,
  });
  await order("por_surtir", { total: 10000, hoursAgo: 50, customerId: fresh, paid: true });
  // Sin pagar: no cuenta en ventas ni aparece en la lista por fecha de pago.
  await order("impago", { total: 7000, hoursAgo: 3, customerId: unpaid, paid: false });

  // Un carrito recuperable: con correo, artículos y 4 h sin actividad (ADR-048).
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status)
    values (${tenant.storeId}, 'Taza azul', ${`taza-${run}`}, 'draft') returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature)
    values (${tenant.storeId}, ${p!.id}, ${`TAZA-${run}`}, 12500, '') returning id`;
  const [cart] = await admin<{ id: string }[]>`
    insert into public.carts (store_id, token_hash, email, last_activity_at)
    values (${tenant.storeId}, sha256(convert_to(${`carrito-${run}`}, 'UTF8')), ${`carrito-${run}@compra.test`},
            now() - interval '4 hours')
    returning id`;
  await admin`insert into public.cart_items (store_id, cart_id, variant_id, quantity)
              values (${tenant.storeId}, ${cart!.id}, ${v!.id}, 2)`;

  // Miembro con analytics.read pero sin customers.read.
  const catalogId = await createAuthUser(catalogEmail);
  await admin`insert into public.organization_members (organization_id, user_id, role)
              values (${tenant.orgId}, ${catalogId}, 'org_member')`;
  await admin`insert into public.store_members (store_id, user_id, role_id)
              select ${tenant.storeId}, ${catalogId}, r.id from public.roles r
               where r.key = 'catalog_manager' and r.organization_id is null`;
});

test("inicio: comparativo, antigüedad, carritos, clientes y enlaces filtrados", async ({
  page,
}) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  const card = (label: string) =>
    page.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd");
  const value = (label: string) => card(label).getByTestId("metric-value");

  // Comparativo (30 días): $300.00 vs. $150.00; 2 vs. 1 pedidos.
  await expect(value("Ventas netas")).toHaveText("$300.00");
  await expect(card("Ventas netas")).toContainText("+$150.00 (+100 %) vs. periodo anterior");
  await expect(value("Pedidos pagados")).toHaveText("2");
  await expect(card("Pedidos pagados")).toContainText("+1 (+100 %) vs. periodo anterior");
  await expect(value("Ticket promedio")).toHaveText("$150.00");
  await expect(card("Ticket promedio")).toContainText("Igual que el periodo anterior");

  // Antigüedad del pendiente más antiguo.
  const pending = page.getByRole("region", { name: "Por atender" });
  await expect(pending.getByRole("listitem").filter({ hasText: "1 por surtir" })).toContainText(
    "El más antiguo: hace 2 días",
  );
  await expect(
    pending.getByRole("listitem").filter({ hasText: "1 pendientes de pago" }),
  ).toContainText("El más antiguo: hace 3 horas");

  // Clientes nuevos vs. recurrentes.
  const clients = page.getByRole("region", { name: "Clientes del periodo" });
  await expect(
    clients.locator("dt", { hasText: "Nuevos" }).locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("1");
  await expect(
    clients.locator("dt", { hasText: "Recurrentes" }).locator("xpath=following-sibling::dd[1]"),
  ).toHaveText("1");
  await expect(clients.getByRole("link", { name: "Ver clientes" })).toHaveAttribute(
    "href",
    `/admin/${tenant.handle}/clientes`,
  );

  // Carritos recuperables: 1 carrito, 2 × $125.00.
  const carts = page.getByRole("region", { name: "Carritos recuperables" });
  await expect(carts).toContainText("1 carrito · $250.00 (estimado con los precios de hoy)");
  await expect(carts).toContainText("El recordatorio por correo está apagado");
  await expectNoSeriousA11yViolations(page);

  // 7 días: el periodo anterior (días 7 a 13) no tiene ventas.
  await page.getByRole("link", { name: "7 días" }).click();
  await expect(value("Ventas netas")).toHaveText("$300.00");
  await expect(card("Ventas netas")).toContainText("Sin ventas en el periodo anterior");
  await expect(card("Pedidos pagados")).toContainText("Sin pedidos en el periodo anterior");
  await expect(card("Ventas netas")).not.toContainText("∞");

  // La cifra lleva a los pedidos pagados del mismo rango, y solo a esos.
  await page.getByRole("link", { name: "30 días" }).click();
  await expect(value("Pedidos pagados")).toHaveText("2");
  await card("Pedidos pagados").getByRole("link").click();
  await expect(page).toHaveURL(
    /\/pedidos\?estado=todos&desde=\d{4}-\d{2}-\d{2}&hasta=\d{4}-\d{2}-\d{2}$/,
  );
  await expect(page.getByText(/^Solo pedidos pagados del .+ al .+\./)).toBeVisible();
  await expect(page.getByRole("table").getByRole("link")).toHaveText([
    numbers.reciente!,
    numbers.por_surtir!,
  ]);
  await expectNoSeriousA11yViolations(page);
});

test("inicio: sin permiso de clientes no se ven datos de clientes", async ({ page }) => {
  await loginNewStaff(page, catalogEmail);
  await page.goto(`/admin/${tenant.handle}`);
  // Con analytics.read ve las ventas y los carritos…
  await expect(
    page
      .locator("dt", { hasText: "Ventas netas" })
      .locator("xpath=following-sibling::dd")
      .getByTestId("metric-value"),
  ).toHaveText("$300.00");
  await expect(page.getByRole("region", { name: "Carritos recuperables" })).toBeVisible();
  // …pero sin customers.read no hay tarjeta, cifras ni enlace de clientes.
  await expect(page.getByRole("heading", { name: "Clientes del periodo" })).toHaveCount(0);
  await expect(page.getByText("Recurrentes", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ver clientes" })).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);
});
