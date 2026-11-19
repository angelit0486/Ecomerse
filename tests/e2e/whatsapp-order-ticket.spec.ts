import { expect, test, type Page } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  uniq,
} from "./support";

/**
 * Ficha del pedido por WhatsApp (interruptor `order_whatsapp_handoff`):
 *  1. Al confirmar, la página del pedido abre WhatsApp sola (3 s) con la ficha
 *     completa: número, productos, totales, envío, dirección, contacto y pago.
 *  2. «Quedarme aquí» detiene la apertura; volver o recargar no la repite y el
 *     botón sigue a la mano.
 *  3. Con el interruptor apagado, la página del pedido queda como antes.
 */
test.describe.configure({ mode: "serial" });

const run = uniq();
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId: string;
let orderUrl = "";
const origin = () => `http://${tenant.handle}.localhost:3000`;

/** Texto del mensaje de un enlace wa.me. */
function waText(href: string | null): string {
  return new URL(href ?? "https://wa.me/").searchParams.get("text") ?? "";
}

async function asOwner<T>(work: (sql: typeof admin) => Promise<T>): Promise<T> {
  return (await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    return work(sql as unknown as typeof admin);
  })) as T;
}

const setFlag = (enabled: boolean) => admin`
  insert into public.feature_flag_overrides (flag_key, scope, scope_id, enabled, reason)
  values ('order_whatsapp_handoff', 'store', ${tenant.storeId}, ${enabled}, 'Prueba E2E de la ficha por WhatsApp')
  on conflict (flag_key, scope, scope_id) do update set enabled = excluded.enabled`;

/** WhatsApp no se abre de verdad: cada visita a wa.me se responde aquí y se cuenta. */
async function stubWhatsapp(page: Page): Promise<string[]> {
  const visits: string[] = [];
  await page.route(/^https:\/\/wa\.me\//, async (route) => {
    if (route.request().isNavigationRequest()) visits.push(route.request().url());
    await route.fulfill({
      contentType: "text/html",
      body: "<title>WhatsApp</title><p>WhatsApp</p>",
    });
  });
  return visits;
}

test.beforeAll(async () => {
  ownerId = await createAuthUser(`ficha-${run}@example.test`);
  tenant = await createTenant(`fw${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now(), tax_rate_bps = 0, country = 'MX'
               where id = ${tenant.storeId}`;
  await asOwner(async (sql) => {
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Taza de barro",
        variants: [{ price: 25000, sku: `FICHA-${run}`, weight_g: 400 }],
      })}) as r`;
    const [v] = await sql<{ id: string }[]>`
      select id from public.product_variants where sku = ${`FICHA-${run}`.toUpperCase()}`;
    await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 20, 'Inicial')`;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
    const [z] = await sql<{ id: string }[]>`
      select public.shipping_upsert_zone(${tenant.storeId}, ${sql.json({ name: "Sonora", countries: ["MX"], regions: ["Sonora"] })}) as id`;
    await sql`select public.shipping_upsert_rate(${tenant.storeId}, ${sql.json({
      zone_id: z!.id,
      name: "Estándar",
      type: "flat",
      price: 20000,
      est_days_min: 1,
      est_days_max: 2,
    })})`;
  });
  await admin`update public.store_themes
                 set settings = settings || ${admin.json({ contact: { whatsapp: "+16503008656" } })}
               where store_id = ${tenant.storeId}`;
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
              values (${tenant.storeId}, 'manual', 'active', 'Transferencia',
                      ${admin.json({ instructions: "BBVA · CLABE 012 180 0012 3456 7890" })})`;
  await setFlag(true);
});

test("al confirmar, WhatsApp se abre solo con la ficha completa del pedido", async ({ page }) => {
  const visits = await stubWhatsapp(page);
  await page.goto(`${origin()}/productos/taza-de-barro`);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado al carrito." })).toBeVisible();
  await page.goto(`${origin()}/checkout`);
  await expect(page.getByRole("heading", { name: "Finalizar compra", exact: true })).toBeVisible();

  await page.getByRole("textbox", { name: "Email" }).fill(`cliente-${run}@example.test`);
  await page.getByLabel("Nombre completo").fill("Ana Ruiz");
  await page.getByLabel(/^Celular/).fill("662 555 0101");
  await page.getByLabel("Calle, número e interior").fill("Av. Reforma 123");
  await page.getByLabel("Colonia").fill("Centro");
  await page.getByLabel("Ciudad o municipio").fill("Hermosillo");
  await page.getByLabel("Código postal").fill("83000");
  await expect(page.getByLabel("Estado", { exact: true })).toHaveValue("Sonora");
  await page.getByRole("radio", { name: /Estándar/ }).check();
  await page.getByRole("radio", { name: /Transferencia/ }).check();
  await page.getByRole("button", { name: "Confirmar pedido · $450.00" }).click();

  // Página del pedido: la ficha con su botón y la cuenta regresiva; la marca de
  // «recién confirmado» ya no está en la dirección.
  await expect(page.getByRole("heading", { name: "Envía tu pedido por WhatsApp" })).toBeVisible();
  await expect(page.locator("[data-handoff=counting]")).toBeVisible();
  await expect(page).toHaveURL(/\/pedido\/[0-9a-f-]+\?t=[^&]+$/);
  orderUrl = page.url();
  const button = page.getByRole("link", { name: "Enviar pedido por WhatsApp" });
  const href = await button.getAttribute("href");
  expect(href).toMatch(/^https:\/\/wa\.me\/16503008656\?text=/);

  const [order] = await admin<{ display_number: string }[]>`
    select display_number from public.orders where store_id = ${tenant.storeId}`;
  const text = waText(href);
  expect(text).toMatch(new RegExp(`^\\*Pedido ${order!.display_number} · TIENDA FW`, "i"));
  for (const line of [
    "*Productos*",
    "• 1 × Taza de barro: $250.00",
    "Subtotal: $250.00",
    "Envío (Estándar): $200.00",
    "*Total: $450.00*",
    "*Entrega a domicilio*",
    "Ana Ruiz",
    "Av. Reforma 123, Centro",
    "C.P. 83000, Hermosillo, Sonora, México",
    "*Contacto*",
    "Cel. +52 662 555 0101",
    `cliente-${run}@example.test`,
    "*Pago:* Transferencia",
    "En cuanto pague, les envío mi comprobante por este chat.",
  ]) {
    expect(text).toContain(line);
  }

  // A los 3 s se abre el chat de la tienda con esa misma ficha.
  await expect.poll(() => visits.length, { timeout: 10_000 }).toBe(1);
  expect(visits[0]).toBe(href);
});

test("«Quedarme aquí» detiene la apertura; recargar no la repite", async ({ page }) => {
  expect(orderUrl).not.toBe("");
  const visits = await stubWhatsapp(page);
  await page.clock.install();
  await page.goto(`${orderUrl}&nuevo=1`);
  await expect(page.locator("[data-handoff=counting]")).toBeVisible();
  await page.getByRole("button", { name: "Quedarme aquí" }).click();
  await expect(page.locator("[data-handoff=counting]")).toHaveCount(0);
  await page.clock.runFor(5_000);
  expect(visits).toEqual([]);
  await expectNoSeriousA11yViolations(page);

  // La dirección ya no lleva la marca: recargar no vuelve a contar.
  await page.reload();
  await expect(page.getByRole("link", { name: "Enviar pedido por WhatsApp" })).toBeVisible();
  await page.clock.runFor(5_000);
  await expect(page.locator("[data-handoff=counting]")).toHaveCount(0);
  expect(visits).toEqual([]);
  // El comprobante por WhatsApp sigue como antes.
  await expect(page.getByRole("link", { name: "Enviar comprobante por WhatsApp" })).toBeVisible();
});

test("con el interruptor apagado, la página del pedido queda como antes", async ({ page }) => {
  const visits = await stubWhatsapp(page);
  await setFlag(false);
  await page.clock.install();
  await page.goto(`${orderUrl}&nuevo=1`);
  await expect(page.getByRole("link", { name: "Enviar comprobante por WhatsApp" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Envía tu pedido por WhatsApp" })).toHaveCount(0);
  await page.clock.runFor(5_000);
  expect(visits).toEqual([]);
});
