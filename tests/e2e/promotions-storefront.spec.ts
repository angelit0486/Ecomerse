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
 * ADR-070, fase 3 · Promociones en la tienda: la tarjeta y la ficha anuncian
 * «Lleva 3, paga 2» y los escalones de mayoreo; el carrito, el checkout, la
 * página del pedido y el correo muestran el ahorro que calculó la base (el
 * navegador no calcula precios ni descuentos).
 */
const run = uniq();
const buyer = `promo-compra-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
let ownerId: string;
const origin = () => `http://${tenant.handle}.localhost:3000`;

async function asOwner<T>(work: (sql: typeof admin) => Promise<T>): Promise<T> {
  return (await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    return work(sql as unknown as typeof admin);
  })) as T;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  ownerId = await createAuthUser(`promo-tienda-${run}@example.test`);
  tenant = await createTenant(`ps${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now(), tax_rate_bps = 0, country = 'MX'
               where id = ${tenant.storeId}`;
  await admin`insert into public.organization_entitlement_overrides (organization_id, key, value_int, reason)
              values (${tenant.orgId}, 'max_active_promotions', 5, 'Prueba E2E de promociones en la tienda')`;
  await asOwner(async (sql) => {
    const ids: Record<string, string> = {};
    for (const [key, title, price] of [
      ["PLY", "Playera básica", 10000],
      ["GOR", "Gorra lisa", 5000],
    ] as const) {
      const [p] = await sql<{ r: { id: string } }[]>`
        select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
          title,
          variants: [{ price, sku: `${key}-${run}`, weight_g: 200 }],
        })}) as r`;
      const [v] = await sql<{ id: string }[]>`
        select id from public.product_variants where sku = ${`${key}-${run}`.toUpperCase()}`;
      await sql`select public.inventory_adjust(${tenant.storeId}, ${v!.id}, 'adjustment', 50, 'Inicial')`;
      await sql`select public.catalog_publish_product(${tenant.storeId}, ${p!.r.id})`;
      ids[key] = p!.r.id;
    }
    const [z] = await sql<{ id: string }[]>`
      select public.shipping_upsert_zone(${tenant.storeId}, ${sql.json({ name: "México", countries: ["MX"] })}) as id`;
    await sql`select public.shipping_upsert_rate(${tenant.storeId}, ${sql.json({
      zone_id: z!.id,
      name: "Estándar",
      type: "flat",
      price: 10000,
    })})`;
    const promos = [
      {
        name: "Playeras 3x2",
        label: "3×2 en playeras",
        type: "buy_n_pay_m",
        rules: { buy: 3, pay: 2 },
        scope: "products",
        product_ids: [ids.PLY!],
      },
      {
        name: "Mayoreo gorras",
        label: "Mayoreo gorras",
        type: "volume",
        rules: {
          mode: "unit_price",
          tiers: [
            { min_qty: 6, value: 4000 },
            { min_qty: 12, value: 3500 },
          ],
        },
        scope: "products",
        product_ids: [ids.GOR!],
      },
    ];
    for (const promo of promos) {
      const [row] = await sql<{ id: string }[]>`
        select public.promotions_upsert(${tenant.storeId}, ${sql.json(promo)}) as id`;
      await sql`select public.promotions_set_status(${tenant.storeId}, ${row!.id}, 'active')`;
    }
  });
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
              values (${tenant.storeId}, 'manual', 'active', 'Transferencia',
                      ${admin.json({ instructions: "Transferencia SPEI a la cuenta de la tienda." })})`;
});

test("tarjetas, ficha, carrito, checkout, pedido y correo con la promoción", async ({ page }) => {
  // 1. Tarjetas: la insignia de cada promoción.
  await page.goto(`${origin()}/productos`);
  const playera = page.getByRole("article").filter({ hasText: "Playera básica" });
  await expect(playera.getByText("Lleva 3, paga 2")).toBeVisible();
  await expect(
    page.getByRole("article").filter({ hasText: "Gorra lisa" }).getByText("Mayoreo desde 6 pzas"),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  // 2. Ficha: qué pide la promoción y, en mayoreo, cada escalón.
  await page.goto(`${origin()}/productos/gorra-lisa`);
  const gorra = page.getByRole("region", { name: "Promoción" });
  await expect(gorra.getByText("Mayoreo gorras")).toBeVisible();
  await expect(gorra.getByText("6 piezas o más: $40.00 c/u")).toBeVisible();
  await expect(gorra.getByText("12 piezas o más: $35.00 c/u")).toBeVisible();

  await page.goto(`${origin()}/productos/playera-basica`);
  const box = page.getByRole("region", { name: "Promoción" });
  await expect(box.getByText("3×2 en playeras")).toBeVisible();
  await expect(box.getByText("Lleva 3, paga 2")).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.screenshot({ path: "test-results/promociones-ficha.png", fullPage: true });

  // 3. Carrito: el ahorro por línea y en el resumen (calculado por la base).
  await page.getByLabel("Cantidad").fill("3");
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado al carrito." })).toBeVisible();
  await page.goto(`${origin()}/carrito`);
  await expect(
    page
      .getByRole("list", { name: "Productos en el carrito" })
      .getByText("3×2 en playeras: −$100.00"),
  ).toBeVisible();
  const summary = page.getByRole("complementary", { name: "Resumen" });
  await expect(summary.getByText("Promoción: 3×2 en playeras")).toBeVisible();
  await expect(summary.getByText("Total sin envío")).toBeVisible();
  await expect(summary.getByText("$200.00", { exact: true })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.screenshot({ path: "test-results/promociones-carrito.png", fullPage: true });

  // 4. Checkout: el resumen repite el ahorro; el total lo decide la base.
  await page.goto(`${origin()}/checkout`);
  const resumen = page.getByRole("complementary", { name: "Resumen del pedido" });
  await expect(resumen.getByText("3×2 en playeras: −$100.00")).toBeVisible();
  await page.getByRole("textbox", { name: "Email" }).fill(buyer);
  await page.getByLabel("Nombre completo").fill("Ana Ruiz");
  await page.getByLabel(/^Celular/).fill("662 555 0101");
  await page.getByLabel("Calle, número e interior").fill("Av. Reforma 123");
  await page.getByLabel("Colonia").fill("Centro");
  await page.getByLabel("Ciudad o municipio").fill("Hermosillo");
  await page.getByLabel("Código postal").fill("83000");
  await page.getByLabel("Estado", { exact: true }).selectOption("Sonora");
  await page.getByRole("radio", { name: /Estándar/ }).check();
  await page.getByRole("radio", { name: /Transferencia/ }).check();
  await page.getByRole("button", { name: /^Confirmar pedido/ }).click();
  await expect(page).toHaveURL(/\/pedido\/[0-9a-f-]+\?t=/);

  // 5. Página del pedido: de la copia guardada en el pedido.
  await expect(page.getByText("3×2 en playeras: −$100.00").first()).toBeVisible();
  await expect(page.getByText("Promoción: 3×2 en playeras").first()).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.screenshot({ path: "test-results/promociones-pedido.png", fullPage: true });
  const [order] = await admin<{ subtotal: string; promotion_total: string; total: string }[]>`
    select subtotal::text, promotion_total::text, total::text from public.orders where store_id = ${tenant.storeId}`;
  expect(order).toEqual({ subtotal: "30000", promotion_total: "10000", total: "30000" });

  // 6. Correo al comprador: la partida y los totales con la promoción.
  let text = "";
  await expect
    .poll(
      async () => {
        await runJobs();
        const res = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${buyer}`)}`);
        const { messages } = (await res.json()) as { messages: { ID: string }[] };
        if (messages.length === 0) return "";
        const full = (await (await fetch(`${MAIL}/api/v1/message/${messages[0]!.ID}`)).json()) as {
          Text: string;
        };
        text = full.Text;
        return text;
      },
      { timeout: 20_000 },
    )
    .toContain("3×2 en playeras: −$100.00");
  expect(text).toContain("Promoción: 3×2 en playeras: −$100.00");
  expect(text).toContain("Total: $300.00");
});
