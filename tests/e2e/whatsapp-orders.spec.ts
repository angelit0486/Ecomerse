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
 * D-INT-02 y D-INT-03: cerrar una venta por transferencia con WhatsApp.
 *  1. El comprador deja su celular (obligatorio), paga por transferencia y ve
 *     las instrucciones, las 24 horas de apartado y el botón para mandar su
 *     comprobante por WhatsApp a la tienda.
 *  2. En el panel, el pedido ofrece «Pedido recibido» (con las instrucciones);
 *     al confirmar el pago, «Pago confirmado». Cada aviso abre el WhatsApp de
 *     quien atiende con el mensaje escrito al celular del cliente.
 */
const run = uniq();
const ownerEmail = `wa-${run}@example.test`;
let tenant: Awaited<ReturnType<typeof createTenant>>;
const origin = () => `http://${tenant.handle}.localhost:3000`;

/** Texto del mensaje de un enlace wa.me. */
function waText(href: string | null): string {
  return decodeURIComponent(new URL(href ?? "https://wa.me/").searchParams.get("text") ?? "");
}

test.beforeAll(async () => {
  tenant = await createTenant(`wa${run}`, await createAuthUser(ownerEmail));
  await admin`update public.stores set status = 'active', launched_at = now(), tax_rate_bps = 0, country = 'MX'
               where id = ${tenant.storeId}`;
  const [p] = await admin<{ id: string }[]>`
    insert into public.products (store_id, title, slug, status, published_at)
    values (${tenant.storeId}, 'Vela aromática', 'vela-aromatica', 'active', now()) returning id`;
  const [v] = await admin<{ id: string }[]>`
    insert into public.product_variants (store_id, product_id, sku, price, option_signature, requires_shipping)
    values (${tenant.storeId}, ${p!.id}, ${`WA-${run}`}, 25000, '', false) returning id`;
  await admin`select app.apply_inventory_movement(${tenant.storeId}, l.id, 'initial', 5, 0)
                from public.inventory_levels l where l.variant_id = ${v!.id}`;
  await admin`update public.store_themes
                 set settings = settings || ${admin.json({ contact: { whatsapp: "+526621234567" } })}
               where store_id = ${tenant.storeId}`;
  await admin`insert into public.payment_accounts (store_id, provider, status, display_name, public_config)
              values (${tenant.storeId}, 'manual', 'active', 'Transferencia',
                      ${admin.json({ instructions: "BBVA · CLABE 012 180 0012 3456 7890" })})`;
});

test("transferencia: comprobante por WhatsApp y avisos con un toque desde el panel", async ({
  page,
}) => {
  await page.goto(`${origin()}/productos/vela-aromatica`);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Agregado al carrito." })).toBeVisible();
  await page.goto(`${origin()}/checkout`);
  await expect(page.getByRole("heading", { name: "Finalizar compra", exact: true })).toBeVisible();

  // El celular es obligatorio aunque no haya envío por paquetería.
  await page.getByRole("button", { name: /Confirmar pedido/ }).click();
  await expect(
    page.getByText("Escribe tu celular: por WhatsApp te avisamos de tu pedido."),
  ).toBeVisible();

  await page.getByRole("textbox", { name: "Email" }).fill(`cliente-${run}@example.test`);
  await page.getByLabel("Nombre completo").fill("Ana Ruiz");
  await page.getByLabel(/^Celular/).fill("662 555 0101");
  await page.getByRole("radio", { name: /Transferencia/ }).check();
  await page.getByRole("button", { name: /Confirmar pedido/ }).click();

  // Página del pedido: instrucciones, 24 horas de apartado y el comprobante por WhatsApp.
  await expect(page.getByText("BBVA · CLABE 012 180 0012 3456 7890")).toBeVisible();
  await expect(page.getByText(/quedan apartados (23|24) horas más/)).toBeVisible();
  const proof = page.getByRole("link", { name: "Enviar comprobante por WhatsApp" });
  await expect(proof).toBeVisible();
  const proofHref = await proof.getAttribute("href");
  expect(proofHref).toMatch(/^https:\/\/wa\.me\/526621234567\?text=/);
  const [order] = await admin<{ id: string; display_number: string }[]>`
    select id, display_number from public.orders where store_id = ${tenant.storeId}`;
  expect(waText(proofHref)).toBe(
    `Hola, Tienda ${`wa${run}`.toUpperCase()}. Les envío el comprobante de pago de mi pedido ${order!.display_number} por $250.00.`,
  );
  await expectNoSeriousA11yViolations(page);

  // Panel: «Pedido recibido» con las instrucciones, al celular del cliente.
  await loginNewStaff(page, ownerEmail);
  await page.goto(`/admin/${tenant.handle}/pedidos/${order!.id}`);
  const received = page.getByRole("link", { name: "Pedido recibido" });
  await expect(received).toBeVisible();
  const receivedHref = await received.getAttribute("href");
  expect(receivedHref).toMatch(/^https:\/\/wa\.me\/526625550101\?text=/);
  expect(waText(receivedHref)).toContain(`Recibimos tu pedido ${order!.display_number}`);
  expect(waText(receivedHref)).toContain("BBVA · CLABE 012 180 0012 3456 7890");
  await expect(page.getByRole("link", { name: "Pago confirmado" })).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);

  // Confirmar la transferencia: ahora el aviso es «Pago confirmado».
  await page.getByRole("button", { name: "Confirmar pago recibido" }).click();
  // Confirmado, la página ya no ofrece confirmarlo (se revalida sola).
  await expect(page.getByRole("button", { name: "Confirmar pago recibido" })).toHaveCount(0);
  const paid = page.getByRole("link", { name: "Pago confirmado" });
  await expect(paid).toBeVisible();
  expect(waText(await paid.getAttribute("href"))).toContain(
    `Confirmamos tu pago de $250.00 del pedido ${order!.display_number}`,
  );
  await expect(page.getByRole("link", { name: "Pedido recibido" })).toHaveCount(0);
});
