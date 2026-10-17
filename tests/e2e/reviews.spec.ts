import { createHash, randomBytes } from "node:crypto";

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
 * ADR-029 de punta a punta: el comprador opina desde el enlace de su pedido
 * entregado, la opinión no aparece hasta que la dueña la publica y entonces la
 * ficha muestra el promedio real (y el JSON-LD lo declara).
 */
const run = uniq();
const ownerEmail = `opiniones-${run}@example.test`;
const token = randomBytes(32).toString("base64url").slice(0, 43);
let tenant: Awaited<ReturnType<typeof createTenant>>;
let orderId: string;
const origin = () => `http://${tenant.handle}.localhost:3000`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const ownerId = await createAuthUser(ownerEmail);
  tenant = await createTenant(`rv${run}`, ownerId);
  await admin`update public.stores set status = 'active', launched_at = now() - interval '60 days' where id = ${tenant.storeId}`;
  let productId = "";
  await admin.begin(async (sql) => {
    await sql`select set_config('request.jwt.claims', ${JSON.stringify({ sub: ownerId, role: "authenticated", aal: "aal2" })}, true)`;
    await sql`set local role authenticated`;
    const [p] = await sql<{ r: { id: string } }[]>`
      select public.catalog_upsert_product(${tenant.storeId}, ${sql.json({
        title: "Creatina monohidratada",
        slug: "creatina",
        variants: [{ price: 49900, sku: `RV-${run}`, inventory_policy: "continue" }],
      })}) as r`;
    productId = p!.r.id;
    await sql`select public.catalog_publish_product(${tenant.storeId}, ${productId})`;
  });
  // Pedido pagado y entregado de «Ana García»; el comprador tiene el enlace con su token.
  const [o] = await admin<{ id: string }[]>`
    insert into public.orders (store_id, number, display_number, checkout_idempotency_key, email, customer_name,
                               requires_shipping, currency, prices_include_tax, tax_rate_bps,
                               tax_applies_to_shipping, subtotal, total, guest_access_token_hash)
    values (${tenant.storeId}, 5001, '#5001', ${`e2e-${run}-${randomBytes(6).toString("hex")}`},
            'ana@example.test', 'Ana García', false, 'MXN', true, 0, false, 49900, 49900,
            ${createHash("sha256").update(token, "utf8").digest()})
    returning id`;
  orderId = o!.id;
  await admin`
    insert into public.order_items (store_id, order_id, variant_id, product_id, product_title, variant_title, sku,
                                    product_type, requires_shipping, unit_price, quantity, line_total)
    select ${tenant.storeId}, ${orderId}, v.id, v.product_id, 'Creatina monohidratada', null, v.sku, 'physical',
           false, v.price, 1, v.price
      from public.product_variants v where v.product_id = ${productId}`;
  await admin`update public.orders set status = 'open', payment_status = 'paid', paid_total = total, paid_at = now()
               where id = ${orderId}`;
  await admin`insert into public.shipments (store_id, order_id, status, shipped_at, delivered_at, idempotency_key)
              values (${tenant.storeId}, ${orderId}, 'delivered', now(), now(), ${`e2e-ship-${run}-000000`})`;
});

test("el comprador opina desde su pedido entregado", async ({ page }) => {
  await page.goto(`${origin()}/pedido/${orderId}?t=${token}`);
  const section = page.getByRole("region", { name: "¿Qué te pareció tu compra?" });
  await expect(section.getByRole("heading", { name: "Creatina monohidratada" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await section.getByLabel("4 estrellas").check({ force: true });
  await section.getByLabel("Título (opcional)").fill("Se disuelve bien");
  await section
    .getByLabel("Tu opinión", { exact: true })
    .fill("Sin grumos y sin sabor. La tomo después de entrenar.");
  await section.getByRole("button", { name: "Enviar opinión" }).click();
  await expect(
    page.getByText("¡Gracias! Tu opinión se publicará cuando la tienda la revise."),
  ).toBeVisible();

  // Pendiente: la ficha todavía no muestra opiniones ni calificación.
  await page.goto(`${origin()}/productos/creatina`);
  await expect(page.getByRole("heading", { name: "Opiniones" })).toHaveCount(0);
  expect(
    (await page.locator('script[type="application/ld+json"]').allTextContents()).join(""),
  ).not.toContain("AggregateRating");
});

test("la dueña la publica y la ficha muestra el promedio real", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/productos/opiniones`);
  await expect(page.getByRole("link", { name: "Por revisar (1)" })).toBeVisible();
  const item = page.getByRole("list", { name: "Opiniones: Por revisar" }).getByRole("listitem");
  await expect(item.getByText("Sin grumos y sin sabor.", { exact: false })).toBeVisible();
  await expect(item.getByText("Ana G.", { exact: false })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await item.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByRole("link", { name: "Publicadas (1)" })).toBeVisible();

  await page.goto(`${origin()}/productos/creatina`);
  const reviews = page.getByRole("region", { name: "Opiniones" });
  await expect(reviews.getByText("1 opinión de compradores verificados")).toBeVisible();
  await expect(reviews.getByText("Se disuelve bien")).toBeVisible();
  await expect(reviews.getByText(/Compra verificada/)).toBeVisible();
  await expect(reviews.getByText("ana@example.test")).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);
  const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).join("");
  // El listado muestra la calificación real en la tarjeta.
  await page.goto(`${origin()}/productos`);
  await expect(page.getByRole("article").getByText("(1 opinión)")).toBeVisible();
  expect(ld).toContain('"@type":"AggregateRating"');
  expect(ld).toContain('"reviewCount":1');
});
