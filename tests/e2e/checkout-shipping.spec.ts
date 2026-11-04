import { expect, test, type Page } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  uniq,
} from "./support";

/**
 * Envío al pagar (interruptor checkout_shipping_messages, DIAGNOSTICO-ENVIO):
 * - con una forma de envío válida el pedido llega a la pantalla de pago;
 * - con una sola forma de envío, queda marcada aunque la guardada ya no aplique;
 * - si ninguna cubre la dirección, el mensaje dice qué falta (el estado), y con
 *   el interruptor apagado se conserva el mensaje anterior.
 */
test.describe.configure({ mode: "serial" });

const run = uniq();
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId: string;
let zoneId: string;
const origin = () => `http://${tenant.handle}.localhost:3000`;

async function asOwner<T>(work: (sql: typeof admin) => Promise<T>): Promise<T> {
  return (await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    return work(sql as unknown as typeof admin);
  })) as T;
}

const setFlag = (enabled: boolean) => admin`
  insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
  values ('checkout_shipping_messages', 'store', ${tenant.storeId}, ${enabled}, 'Prueba E2E del envío al pagar')
  on conflict (flag_key, scope, scope_id) do update set enabled = excluded.enabled`;

const upsertRate = (name: string, price: number) =>
  asOwner(async (sql) => {
    const [r] = await sql<{ id: string }[]>`
      select public.shipping_upsert_rate(${tenant.storeId}, ${sql.json({
        zone_id: zoneId,
        name,
        type: "flat",
        price,
        est_days_min: 2,
        est_days_max: 5,
      })}) as id`;
    return r!.id;
  });

async function fillAddress(page: Page, postal: string, state: string) {
  await page.getByRole("textbox", { name: "Email" }).fill("comprador@example.test");
  await page.getByLabel("Nombre completo").fill("Ana Ruiz");
  await page.getByLabel(/^Teléfono/).fill("2221234567");
  await page.getByLabel("Calle, número e interior").fill("Av. Juárez 10");
  await page.getByLabel("Colonia").fill("Centro");
  await page.getByLabel("Ciudad o municipio").fill("Ciudad");
  await page.getByLabel("Código postal").fill(postal);
  await expect(page.getByLabel("Estado", { exact: true })).toHaveValue(state);
}

async function toCheckout(page: Page) {
  await page.goto(`${origin()}/productos/taza-de-barro`);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado al carrito." })).toBeVisible();
  await page.goto(`${origin()}/checkout`);
  await expect(page.getByRole("heading", { name: "Finalizar compra", exact: true })).toBeVisible();
}

test.beforeAll(async () => {
  ownerId = await createAuthUser(`envio-${run}@example.test`);
  tenant = await createTenant(`ce${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  await asOwner(async (sql) => {
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Taza de barro",
        variants: [{ price: 25000, sku: `TAZA-${run}`, weight_g: 400 }],
      })}) as r`;
    const [v] = await sql<{ id: string }[]>`
      select id from public.product_variants where sku = ${`TAZA-${run}`.toUpperCase()}`;
    await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 20, 'Inicial')`;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
    // Solo Puebla: Sinaloa queda sin cobertura.
    const [z] = await sql<{ id: string }[]>`
      select public.shipping_upsert_zone(${tenant.storeId}, ${sql.json({ name: "Centro", countries: ["MX"], regions: ["Puebla"] })}) as id`;
    zoneId = z!.id;
  });
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name)
              values (${tenant.storeId}, 'fake', 'active', 'Tarjeta (prueba)')`;
  await admin`insert into public.platform_settings (key, value) values ('payments.allow_fake', '{"enabled": true}')
              on conflict (key) do nothing`;
});

test("con envío válido y una sola forma de envío: marcada sola y llega al pago", async ({
  page,
}) => {
  await setFlag(true);
  const first = await upsertRate("Estándar", 9900);
  await toCheckout(page);
  await fillAddress(page, "72000", "Puebla");
  await page.getByRole("button", { name: /Confirmar pedido/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Elegimos «Estándar»" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Estándar/ })).toBeChecked();

  // La tarifa guardada en el carrito deja de ofrecerse y queda otra sola: al
  // volver, esa se marca sola (antes, ninguna).
  await admin`update public.shipping_rates set is_active = false where id = ${first}`;
  await upsertRate("Mensajería", 12900);
  await page.reload();
  const shipping = page.getByRole("group", { name: "Forma de envío" });
  await expect(shipping.getByRole("radio")).toHaveCount(1);
  await expect(shipping.getByRole("radio", { name: /Mensajería/ })).toBeChecked();
  await expectNoSeriousA11yViolations(page);

  // El total en pantalla aún no llevaba el envío nuevo: la base lo recalcula y
  // pide confirmar con el total correcto (el navegador no manda en el total).
  await page.getByRole("button", { name: /Confirmar pedido/ }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "El total cambió a $379.00" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirmar pedido · $379.00" }).click();
  await expect(page.getByRole("heading", { name: "Pago de prueba" })).toBeVisible();
  await page.screenshot({ path: "test-results/envio-pantalla-de-pago.png", fullPage: true });
});

test("sin envío para la dirección: el mensaje dice qué falta; apagado, el de antes", async ({
  page,
}) => {
  await setFlag(true);
  await toCheckout(page);
  await fillAddress(page, "80000", "Sinaloa");
  await page.getByRole("button", { name: /Confirmar pedido/ }).click();
  const clear =
    "Esta tienda todavía no hace envíos a Sinaloa. Revisa el estado de tu dirección o escríbele a la tienda.";
  await expect(page.getByRole("alert").filter({ hasText: clear }).first()).toBeVisible();
  // Una vez en el recuadro de envío y otra junto al botón; sin repetirse.
  await expect(page.getByText(clear)).toHaveCount(2);
  await expect(page.getByText("Elige una forma de envío disponible")).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);
  await page.screenshot({ path: "test-results/envio-sin-cobertura.png", fullPage: true });
  const [orders] = await admin<{ n: number }[]>`
    select count(*)::int as n from public.orders where store_id = ${tenant.storeId} and shipping_address->>'region' = 'Sinaloa'`;
  expect(orders!.n).toBe(0);

  // Interruptor apagado: el comportamiento anterior, sin cambios.
  await setFlag(false);
  await page.reload();
  await expect(page.getByText("No hay envíos disponibles para esta dirección.")).toBeVisible();
  await page.getByRole("button", { name: /Confirmar pedido/ }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Elige una forma de envío disponible para tu dirección." })
      .first(),
  ).toBeVisible();
});

test("teléfono escrito con puntos (222.123.4567): no se rechaza y llega al pago", async ({
  page,
}) => {
  await setFlag(false);
  await toCheckout(page);
  await fillAddress(page, "72000", "Puebla");
  await page.getByLabel(/^Teléfono/).fill("222.123.4567");
  // Uno o dos clics: si el servidor elige el envío, pide confirmar con el total.
  const confirm = page.getByRole("button", { name: /Confirmar pedido/ });
  const paid = page.getByRole("heading", { name: "Pago de prueba" });
  await confirm.click();
  await expect(paid.or(page.getByText(/Elegimos «/))).toBeVisible();
  if (!(await paid.isVisible())) await confirm.click();
  await expect(paid).toBeVisible();
  await expect(page.getByText("Escribe un teléfono válido.")).toHaveCount(0);
  const [order] = await admin<{ phone: string }[]>`
    select shipping_address->>'phone' as phone from public.orders
     where store_id = ${tenant.storeId} order by created_at desc limit 1`;
  expect(order!.phone).toBe("222 123 4567");
});
