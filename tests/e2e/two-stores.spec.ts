import { expect, test, type Page } from "@playwright/test";

import { admin, createAuthUser, createTenant, uniq } from "./support";

/**
 * Paso 3 del estudio: el mismo comprador, en el mismo navegador, compra en dos
 * tiendas. Carrito, pedido, numeración y enlace del pedido son de cada tienda;
 * nada de una aparece en la otra.
 */
const run = uniq();
type Tenant = Awaited<ReturnType<typeof createTenant>>;
let a: Tenant;
let b: Tenant;
const origin = (t: Tenant) => `http://${t.handle}.localhost:3000`;

async function launch(t: Tenant, ownerId: string, title: string, slug: string, price: number) {
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${t.storeId}`;
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${t.storeId}, ${sql.json({
        title,
        slug,
        variants: [{ price, sku: `${slug}-${run}`.toUpperCase(), weight_g: 300 }],
      })}) as r`;
    const [v] = await sql<{ id: string }[]>`
      select id from public.product_variants where product_id = ${p!.r.id}`;
    await sql`select public.inventory_adjust(${t.storeId}, ${v!.id}, 'adjustment', 5, 'Inicial')`;
    await sql`select public.catalog_publish_product(${t.storeId}, ${p!.r.id})`;
    const [zone] = await sql<{ id: string }[]>`
      select public.shipping_upsert_zone(${t.storeId}, ${sql.json({ name: "México", countries: ["MX"] })}) as id`;
    await sql`select public.shipping_upsert_rate(${t.storeId}, ${sql.json({
      zone_id: zone!.id,
      name: "Estándar",
      type: "flat",
      price: 9900,
      est_days_min: 2,
      est_days_max: 5,
    })})`;
  });
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name)
              values (${t.storeId}, 'fake', 'active', 'Tarjeta (prueba)')`;
}

async function addToCart(page: Page, t: Tenant, slug: string) {
  await page.goto(`${origin(t)}/productos/${slug}`);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado al carrito." })).toBeVisible();
}

async function checkout(page: Page, t: Tenant): Promise<string> {
  await page.goto(`${origin(t)}/checkout`);
  await page.getByRole("textbox", { name: "Email" }).fill("misma@example.test");
  await page.getByLabel("Nombre completo").fill("Ana Ruiz");
  await page.getByLabel(/^Teléfono/).fill("2221234567");
  await page.getByLabel("Calle, número e interior").fill("Av. Juárez 10");
  await page.getByLabel("Colonia").fill("Centro");
  await page.getByLabel("Ciudad o municipio").fill("Puebla");
  await page.getByLabel("Estado", { exact: true }).fill("Puebla");
  await page.getByLabel("Código postal").fill("72000");
  await page.getByRole("button", { name: /Confirmar pedido/ }).click();
  // El servidor elige el envío y pide confirmar con el total a la vista.
  await expect(page.getByRole("radio", { name: /Estándar/ })).toBeChecked();
  await page.getByRole("button", { name: /Confirmar pedido/ }).click();
  await page.getByRole("button", { name: "Aprobar pago" }).click();
  await expect(page.getByRole("heading", { name: "Gracias por tu compra" })).toBeVisible();
  return page.url();
}

test.beforeAll(async () => {
  const ownerA = await createAuthUser(`dos-a-${run}@example.test`);
  const ownerB = await createAuthUser(`dos-b-${run}@example.test`);
  a = await createTenant(`a${run}`, ownerA);
  b = await createTenant(`b${run}`, ownerB);
  await admin`insert into public.platform_settings (key, value) values ('payments.allow_fake', '{"enabled": true}')
              on conflict (key) do nothing`;
  await launch(a, ownerA, "Termo de acero", "termo", 30000);
  await launch(b, ownerB, "Libreta de piel", "libreta", 20000);
});

test("el mismo comprador compra en dos tiendas sin que se mezcle nada", async ({ page }) => {
  await addToCart(page, a, "termo");
  await expect(page.getByRole("link", { name: /^Carrito/ })).toContainText("1");

  // En B: carrito vacío y el producto de A no existe.
  await page.goto(`${origin(b)}/`);
  await expect(page.getByRole("link", { name: /^Carrito/ })).toContainText("0");
  const foreign = await page.goto(`${origin(b)}/productos/termo`);
  expect(foreign?.status()).toBe(404);

  await addToCart(page, b, "libreta");
  const orderB = await checkout(page, b);
  await expect(page.getByText("$299.00").first()).toBeVisible();

  // El carrito de A sigue intacto y A no tiene pedidos.
  await page.goto(`${origin(a)}/`);
  await expect(page.getByRole("link", { name: /^Carrito/ })).toContainText("1");
  const [countA] = await admin<{ n: number }[]>`
    select count(*)::int as n from public.orders where store_id = ${a.storeId}`;
  expect(countA!.n).toBe(0);

  // El enlace del pedido de B no abre en A.
  const leaked = await page.goto(orderB.replace(origin(b), origin(a)));
  expect(leaked?.status()).toBe(404);

  await checkout(page, a);
  const orders = await admin<{ store_id: string; number: string; total: string }[]>`
    select store_id, number::text, total::text from public.orders
     where store_id in (${a.storeId}, ${b.storeId}) order by total`;
  expect(orders).toEqual([
    { store_id: b.storeId, number: "1001", total: "29900" },
    { store_id: a.storeId, number: "1001", total: "39900" },
  ]);
});
