import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/** F8-T03: KPIs del inicio contra un seed conocido. */
const run = uniq();
const ownerEmail = `kpis-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;

async function paid(total: number, title: string, qty: number, hoursAgo: number) {
  const [o] = await admin<{ id: string }[]>`
    insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                               requires_shipping, currency, prices_include_tax, tax_rate_bps, tax_applies_to_shipping,
                               subtotal, total)
    select ${tenant.storeId}, n, '#' || n, ${`kpi-${run}-${title}-${hoursAgo}`}, 'k@example.test', 'K', false, 'MXN',
           true, 0, false, 0, 0
      from (select coalesce(max(number), 1000) + 1 as n from public.orders where store_id = ${tenant.storeId}) x
    returning id`;
  await admin.begin(async (sql) => {
    await sql`set local session_replication_role = replica`;
    await sql`update public.orders set subtotal = ${total}, total = ${total}, paid_total = ${total},
                     paid_at = now() - make_interval(hours => ${hoursAgo}), status = 'open', payment_status = 'paid',
                     fulfillment_status = 'unfulfilled'
               where id = ${o!.id}`;
    await sql`insert into public.order_items (store_id, order_id, product_title, product_type, requires_shipping,
                                              unit_price, quantity, line_total)
              values (${tenant.storeId}, ${o!.id}, ${title}, 'physical', false, ${total / qty}, ${qty}, ${total})`;
  });
}

test.beforeAll(async () => {
  tenant = await createTenant(`k${run}`, await createAuthUser(ownerEmail));
  await paid(30000, "Mochila", 1, 2);
  await paid(12000, "Llavero", 4, 3);
  await paid(9000, "Llavero", 3, 24 * 40); // fuera de los 30 días
});

test("inicio: ventas, pedidos, ticket promedio y más vendidos del periodo", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}`);
  const tile = (label: string) =>
    page.locator("dt", { hasText: label }).locator("xpath=following-sibling::dd");
  await expect(tile("Ventas netas")).toHaveText("$420.00");
  await expect(tile("Pedidos pagados")).toHaveText("2");
  await expect(tile("Ticket promedio")).toHaveText("$210.00");
  await expect(page.getByText("3 por surtir")).toBeVisible(); // estado actual, no del periodo
  const top = page.getByRole("heading", { name: "Más vendidos" }).locator("xpath=..");
  await expect(top.getByRole("listitem").first()).toContainText("1. Llavero");
  await expect(top.getByRole("listitem").first()).toContainText("4 u");
  await expectNoSeriousA11yViolations(page);

  await page.getByRole("link", { name: "90 días" }).click();
  await expect(tile("Pedidos pagados")).toHaveText("3");
  await expect(tile("Ventas netas")).toHaveText("$510.00");

  // «Por surtir» lleva a esos pedidos, del más antiguo al más nuevo (C2).
  await page.getByRole("link", { name: "3 por surtir" }).click();
  await expect(page.getByRole("link", { name: "Por surtir" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const numbers = page.getByRole("table").getByRole("link");
  await expect(numbers).toHaveText(["#1001", "#1002", "#1003"]);
  await expectNoSeriousA11yViolations(page);
});
