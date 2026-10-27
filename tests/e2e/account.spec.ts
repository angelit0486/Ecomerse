import { createHash, randomBytes } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  readEmailCode,
  uniq,
} from "./support";

/**
 * F8-T01: cuenta del comprador por tienda. Código por email en el dominio de la
 * tienda; sus pedidos de invitado aparecen; otra tienda no comparte la sesión ni
 * los pedidos.
 */
const run = uniq();
const buyer = `compradora-${run}@example.test`;
let a: Awaited<ReturnType<typeof createTenant>>;
let b: Awaited<ReturnType<typeof createTenant>>;
let orderA: string;
let orderB: string;

async function store(key: string) {
  const t = await createTenant(key, await createAuthUser(`duena-${key}@example.test`));
  await admin`update public.stores set status = 'active', launched_at = now(), tax_rate_bps = 0 where id = ${t.storeId}`;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${t.storeId}, 'Cuaderno', 'cuaderno', 'active', now()) returning id`;
  await admin`insert into public.product_variants (store_id, product_id, sku, price, option_signature, requires_shipping)
              values (${t.storeId}, ${p!.id}, ${`CU-${key}`}, 10000, '', false)`;
  await admin`select app.apply_inventory_movement(${t.storeId}, l.id, 'initial', 10, 0)
                from public.inventory_levels l join public.product_variants v on v.id = l.variant_id
               where v.store_id = ${t.storeId}`;
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
              values (${t.storeId}, 'manual', 'active', 'Transferencia', '{"instructions":"CLABE 0123456789"}')`;
  return t;
}

async function guestOrder(storeId: string): Promise<string> {
  const [v] = await admin<{ id: string }[]>`
    select id from public.product_variants where store_id = ${storeId}`;
  const [acct] = await admin<{ id: string }[]>`
    select id from public.payment_accounts where store_id = ${storeId}`;
  const token = randomBytes(32).toString("base64url");
  await admin`select storefront.cart_add_item(${storeId}, ${token}, ${v!.id}, 1)`;
  const idem = `idem-${randomBytes(12).toString("hex")}`;
  const [o] = await admin<{ r: { order_id: string } }[]>`
    select storefront.place_order(${storeId}, ${token}, ${admin.json({
      email: buyer,
      customer_name: "Compradora",
      payment_account_id: acct!.id,
    })}, 10000, ${idem}, ${createHash("sha256").update(idem).digest()}) as r`;
  return o!.r.order_id;
}

test.beforeAll(async () => {
  a = await store(`ca${run}`);
  b = await store(`cb${run}`);
  orderA = await guestOrder(a.storeId);
  orderB = await guestOrder(b.storeId);
});

const origin = (t: { handle: string }) => `http://${t.handle}.localhost:3000`;

test("comprador: entra con código, ve su pedido de invitado y guarda una dirección", async ({
  page,
  browser,
}) => {
  await page.goto(`${origin(a)}/`);
  await page.getByRole("link", { name: "Mi cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Mi cuenta" })).toBeVisible();
  const sentAfter = Date.now();
  await page.getByLabel("Email").fill(buyer);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page.getByRole("heading", { name: "Revisa tu email" })).toBeVisible();
  await page.getByLabel("Código de 6 dígitos").fill("000000");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "no es correcto" })).toBeVisible();
  await page.getByLabel("Código de 6 dígitos").fill(await readEmailCode(buyer, sentAfter));
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByRole("heading", { name: "Mis pedidos" })).toBeVisible();
  await expect(page.getByText(buyer)).toBeVisible();
  const links = page.getByRole("link", { name: /^Pedido / });
  await expect(links).toHaveCount(1);
  await expect(links.first()).toHaveAttribute("href", `/cuenta/pedidos/${orderA}`);
  await expectNoSeriousA11yViolations(page);

  await page.getByLabel("Nombre de quien recibe").fill("Compradora Uno");
  await page.getByLabel("Calle y número").fill("Av. Siempre Viva 742");
  await page.getByLabel("Ciudad").fill("Monterrey");
  await page.getByLabel("Estado").selectOption("Nuevo León");
  await page.getByLabel("Código postal").fill("64000");
  await page.getByRole("button", { name: "Agregar dirección" }).click();
  await expect(page.getByText("Dirección guardada.")).toBeVisible();
  await expect(page.getByText(/Av\. Siempre Viva 742, 64000 Monterrey/)).toBeVisible();

  await links.first().click();
  await expect(page.getByRole("heading", { name: /^Pedido / })).toBeVisible();
  await expect(page.getByText("1 × Cuaderno")).toBeVisible();
  // Sin entregar no se ofrece opinar; ya pagado y entregado, sí (ADR-029).
  await expect(page.getByRole("region", { name: "¿Qué te pareció tu compra?" })).toHaveCount(0);
  await admin`update public.orders set status = 'open', payment_status = 'paid', paid_total = total, paid_at = now()
               where id = ${orderA}`;
  await admin`insert into public.shipments (store_id, order_id, status, shipped_at, delivered_at, idempotency_key)
              values (${a.storeId}, ${orderA}, 'delivered', now(), now(), ${`e2e-acct-${run}-0000000`})`;
  await page.reload();
  const opinar = page.getByRole("region", { name: "¿Qué te pareció tu compra?" });
  await opinar.getByLabel("5 estrellas").check({ force: true });
  await opinar.getByLabel("Tu opinión", { exact: true }).fill("Buen papel y llegó a tiempo.");
  await opinar.getByRole("button", { name: "Enviar opinión" }).click();
  await expect(
    page.getByText("¡Gracias! Tu opinión se publicará cuando la tienda la revise."),
  ).toBeVisible();

  // El pedido de la otra tienda no se abre aquí, aunque sea del mismo email.
  const other = await page.goto(`${origin(a)}/cuenta/pedidos/${orderB}`);
  expect(other?.status()).toBe(404);

  // La sesión es de ESTA tienda: en la otra no hay sesión (cookies host-only).
  const second = await browser.newContext();
  const pageB = await second.newPage();
  const cookiesA = await page.context().cookies(origin(a));
  await second.addCookies(cookiesA.map((c) => ({ ...c, domain: `${b.handle}.localhost` })));
  await pageB.goto(`${origin(b)}/cuenta`);
  // Aun con las cookies copiadas, en B la cuenta no está vinculada: pide el código.
  await expect(pageB.getByRole("button", { name: "Enviarme un código" })).toBeVisible();
  await second.close();

  await page.goto(`${origin(a)}/cuenta`);
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await page.waitForURL(`${origin(a)}/`); // la acción termina con la redirección al inicio
  await page.goto(`${origin(a)}/cuenta`);
  await expect(page.getByRole("button", { name: "Enviarme un código" })).toBeVisible();

  const [c] = await admin<{ n: number }[]>`
    select count(*)::int as n from public.customers where email = ${buyer} and user_id is not null`;
  expect(c!.n).toBe(1); // solo vinculado en la tienda A
});
