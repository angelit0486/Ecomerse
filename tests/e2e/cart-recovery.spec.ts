import { expect, test } from "@playwright/test";

import { optoutPath } from "@/server/notifications/cart-recovery-links";

import {
  admin,
  createAuthUser,
  createTenant,
  expectNoSeriousA11yViolations,
  loginNewStaff,
  uniq,
} from "./support";

/**
 * ADR-048: la tienda activa el recordatorio; el comprador vuelve a su carrito con
 * el enlace del correo (confirmando con un botón) y puede darse de baja.
 */
test.describe.configure({ mode: "serial" });

const run = uniq();
const ownerEmail = `recordatorio-${run}@example.test`;
const buyer = `comprador-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const origin = () => `http://${tenant.handle}.localhost:3000`;

test.beforeAll(async () => {
  tenant = await createTenant(`r${run}`, await createAuthUser(ownerEmail));
  await admin`update public.stores set status = 'active', launched_at = now() where id = ${tenant.storeId}`;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${tenant.storeId}, 'Creatina pura', 'creatina', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature)
    values (${tenant.storeId}, ${p!.id}, ${`CR-${run}`.toUpperCase()}, 39900, '') returning id`;
  await admin`select app.apply_inventory_movement(${tenant.storeId}, l.id, 'initial', 20, 0)
                from public.inventory_levels l where l.variant_id = ${v!.id}`;
  const token = Buffer.from(`${run}`.padEnd(32, "x")).toString("base64url");
  await admin`select storefront.cart_add_item(${tenant.storeId}, ${token}, ${v!.id}, 3)`;
  await admin`update public.carts set email = ${buyer}, last_activity_at = now() - interval '4 hours'
               where store_id = ${tenant.storeId}`;
});

test("la tienda activa el recordatorio de carritos", async ({ page }) => {
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/ajustes/notificaciones`);
  const toggle = page.getByLabel("Enviar el recordatorio a quien deje su carrito");
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await page.getByRole("button", { name: "Guardar recordatorio" }).click();
  await expect(page.getByText("Recordatorio de carritos activado.")).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.reload();
  await expect(toggle).toBeChecked();
});

test("el comprador vuelve a su carrito con el enlace y se da de baja", async ({ page }) => {
  const [due] = await admin<{ token: string }[]>`
    select d.token from system.cart_recovery_due(200) d where d.store_id = ${tenant.storeId}`;
  expect(due?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

  await page.goto(`${origin()}/carrito/recuperar?t=${due!.token}`);
  await expect(page.getByRole("heading", { name: "Tu carrito te espera" })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("button", { name: "Volver a mi carrito" }).click();
  await expect(page.getByRole("heading", { name: "Tu carrito" })).toBeVisible();
  await expect(page.getByText("Creatina pura").first()).toBeVisible();

  // Un solo uso: el mismo enlace ya no sirve.
  await page.goto(`${origin()}/carrito/recuperar?t=${due!.token}`);
  await page.getByRole("button", { name: "Volver a mi carrito" }).click();
  await expect(page.getByRole("heading", { name: "Este enlace ya no sirve" })).toBeVisible();

  // Baja: sin firma válida no se ofrece; con el enlace del correo, sí.
  await page.goto(`${origin()}/carrito/recordatorios?h=${"0".repeat(64)}&s=${"a".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "Este enlace no es válido" })).toBeVisible();
  const path = optoutPath(process.env.ORDER_LINK_SECRET!, tenant.storeId, buyer);
  await page.goto(`${origin()}${path}`);
  await expect(
    page.getByRole("heading", { name: "¿Dejar de recibir recordatorios?" }),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole("button", { name: "No quiero recibir recordatorios" }).click();
  await expect(
    page.getByRole("heading", { name: "Listo: ya no recibirás recordatorios" }),
  ).toBeVisible();
  const [row] = await admin<{ n: number }[]>`
    select count(*)::int as n from public.cart_recovery_optouts
     where store_id = ${tenant.storeId} and email_hash = app.email_hash(${buyer})`;
  expect(row!.n).toBe(1);
});
